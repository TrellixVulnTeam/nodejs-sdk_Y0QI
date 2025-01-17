/*
 Copyright IBM Corp 2016 All Rights Reserved.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

/**
 * This example shows how to do the following in a web app.
 * 1) At initialization time, enroll the web app with the blockchain.
 *    The identity must have already been registered.
 * 2) At run time, after a user has authenticated with the web app:
 *    a) register and enroll an identity for the user;
 *    b) use this identity to deploy, query, and invoke a chaincode.
 */
process.env.GOPATH = __dirname;

var hfc = require('hfc');
var util = require('util');
var fs = require('fs');

//get the addresses from the docker-compose environment
var PEER_ADDRESS         = process.env.PEER_ADDRESS;
var MEMBERSRVC_ADDRESS   = process.env.MEMBERSRVC_ADDRESS;

var config;
var chain;
var network;
var peers;
var member_services;

var userObj;
var newUserName;
var chaincodeID;
var chaincodeIDPath = __dirname + "/chaincodeID";
var peerUrls = [];

init();

function init(){
  try {
      config = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
  } catch (err) {
      console.log("config.json is missing or invalid file, Rerun the program with right file")
      process.exit();
  }
	
	console.log("PEER address: " + PEER_ADDRESS);
	// Create a client chain.
	// The name can be anything as it is only used internally.
	chain = hfc.newChain(config.chainName);

	// Set the blockchain to be in development mode
	chain.setDevMode(true);

	//this hard coded list is intentionaly left here, feel free to use it when initially starting out
	//please create your own network when you are up and running
	try {
		network = JSON.parse(fs.readFileSync('mycreds_docker_compose.json', 'utf8'));
		peers = network.peers;
		console.log(peers)
		console.log('loading hardcoded peers');

		users = null;																			//users are only found if security is on
		if(network.users) users = network.users;
		console.log('loading hardcoded users');

		member_services = network.memberservices
		
	} catch(err){
     console.log("mycreds_docker_compose.json is missing or invalid file, Running without certs")
	}

	peerUrls = [];
	setup();
  printNetworkDetails();

	// Invoke a contract transaction on the blockchain
	if (fileExists(chaincodeIDPath)){

		// Read chaincodeID and use this for sub sequent Invokes/Queries
    chaincodeID = fs.readFileSync(chaincodeIDPath, 'utf8');

		// enrollAndRegisterUsers();
    chain.getUser(newUserName, function(err, user) {
        if (err) throw Error(" Failed to register and enroll " + deployerName + ": " + err);
        userObj = user;
        invoke_contract();
    });
	} else {
	
		// Register & enroll the admin and a user on the peer
		// Also deploy to the blockchain to initialize blockchain state
		enrollAndRegisterUsers();
	}
}

function setup() {

	peerUrls = [];
  
	// Adding all the peers to blockchain
  // this adds high availability for the client
  for (var i = 0; i < peers.length; i++) {

		console.log("peer: " + peers[i].discovery_host + ":" + peers[i].discovery_port);
    // Peers on Bluemix require secured connections, hence 'grpcs://'
    peerUrls.push("grpc://" + peers[i].discovery_host + ":" + peers[i].discovery_port);

		// Add at least one peer's URL.  If you add multiple peers, it will failover
		// to the 2nd if the 1st fails, to the 3rd if both the 1st and 2nd fails, etc.
    chain.addPeer(peerUrls[i]);
  }

	// Configure the KeyValStore which is used to store sensitive keys
	// as so it is important to secure this storage.
	// The FileKeyValStore is a simple file-based KeyValStore, but you
	// can easily implement your own to store whereever you want.
	// To work correctly in a cluster, the file-based KeyValStore must
	// either be on a shared file system shared by all members of the cluster
	// or you must implement you own KeyValStore which all members of the
	// cluster can share.
	chain.setKeyValStore( hfc.newFileKeyValStore('/tmp/keyValStore') );

	// Set the URL for membership services
	//chain.setMemberServicesUrl("grpc://" + member_services.api_host + ":" + member_services.api_port);
	chain.setMemberServicesUrl("grpc://localhost:7054");

  newUserName = config.user.username;
}

function printNetworkDetails() {
    console.log("\n------------- peers and event URL:PORT information: -------------");
    for (var i = 0; i < peers.length; i++) {
        console.log("Validating Peer%d : %s", i, peers[i]);
    }
    console.log("");
    console.log('-----------------------------------------------------------\n');
}

function enrollAndRegisterUsers(){
	console.log("In enrollAndRegisterUsers\n");
	// Enroll "WebAppAdmin" which is already registered because it is
	// listed in fabric/membersrvc/membersrvc.yaml with its one time password.
	// If "WebAppAdmin" has already been registered, this will still succeed
	// because it stores the state in the KeyValStore
	// (i.e. in '/tmp/keyValStore' in this sample).
	console.log("user: " + users[0].enrollId);
	chain.enroll(users[0].enrollId, users[0].enrollSecret, function(err, admin) {
		if (err) return console.log("ERROR: failed to register WebAdmin: %s",err);

		console.log("Successfully enrolled WebAdmin with memeber services\n");

		// Successfully enrolled WebAppAdmin during initialization.
		// Set this user as the chain's registrar which is authorized to register other users.
		chain.setRegistrar(admin);
			
		//creating a new user
		newUserName = config.user.username;
		var registrationRequest = {
			     roles: [ 'client' ],
				   enrollmentID: newUserName,
					 affiliation: "bank_a",
					attributes: [{name:'role',value:'client'},{name:'account',value:'Technical Leader'}]
		};
			
		chain.registerAndEnroll(registrationRequest,function(err, user){
			if (err) throw Error("Failed to register and enroll " + newUserName + ": " + err);
			
			console.log("Successfully enrolled user: %s with memberservices as a client\n", newUserName);
			userObj = user;

			chain.setDeployWaitTime(config.deployWaitTime);
			deployChaincode();

		});
	});
}

function deployChaincode() {
    var args = getArgs(config.deployRequest);
    // Construct the deploy request
    var deployRequest = {
				chaincodeName: config.deployRequest.chaincodeName,
        // Function to trigger
        fcn: config.deployRequest.functionName,
        // Arguments to the initializing function
        args: args,
        chaincodePath: config.deployRequest.chaincodePath,
    };

    // Trigger the deploy transaction
    var deployTx = userObj.deploy(deployRequest);

    // Print the deploy results
    deployTx.on('complete', function(results) {
        // Deploy request completed successfully
        chaincodeID = results.chaincodeID;
        console.log("\nChaincode ID : " + chaincodeID);
        console.log(util.format("\nSuccessfully deployed chaincode: request=%j, response=%j", deployRequest, results));
        // Save the chaincodeID
        fs.writeFileSync(chaincodeIDPath, chaincodeID);
    });

    deployTx.on('error', function(err) {
        // Deploy request failed
        console.log(util.format("\nFailed to deploy chaincode: request=%j, error=%j", deployRequest, err));
        process.exit(1);
    });
}

function invoke_contract() {
    var args = getArgs(config.invokeContract);

    // Construct the invoke request
    var invokeRequest = {
        // Name (hash) required for invoke
        chaincodeID: chaincodeID,
        // Function to trigger
        fcn: config.invokeContract.functionName,
        // Parameters for the invoke function
        args: args
    };

    // Trigger the invoke transaction
    var invokeTx = userObj.invoke(invokeRequest);

    // Print the invoke results
    invokeTx.on('submitted', function(results) {
        // Invoke transaction submitted successfully
        console.log(util.format("\nSuccessfully submitted chaincode invoke contract transaction: request=%j, response=%j", invokeRequest, results));
    });
    invokeTx.on('complete', function(results) {
        // Invoke transaction completed successfully
        console.log(util.format("\nSuccessfully completed chaincode invoke contract transaction: request=%j, response=%j", invokeRequest, results));
        query();
    });
    invokeTx.on('error', function(err) {
        // Invoke transaction submission failed
        console.log(util.format("\nFailed to submit chaincode invoke contract transaction: request=%j, error=%j", invokeRequest, err));
        process.exit(1);
    });

    //Listen to custom events
    //var regid = eh.registerChaincodeEvent(chaincodeID, "evtsender", function(event) {
    //    console.log(util.format("Custom event received, payload: %j\n", event.payload.toString()));
    //    eh.unregisterChaincodeEvent(regid);
    //});
}

function invoke_shipment() {
    var args = getArgs(config.invokeRequestShip);
    var eh = chain.getEventHub();
    // Construct the invoke request
    var invokeRequest = {
        // Name (hash) required for invoke
        chaincodeID: chaincodeID,
        // Function to trigger
        fcn: config.invokeRequestShip.functionName,
        // Parameters for the invoke function
        args: args
    };

    // Trigger the invoke transaction
    var invokeTx = userObj.invoke(invokeRequest);

    // Print the invoke results
    invokeTx.on('submitted', function(results) {
        // Invoke transaction submitted successfully
        console.log(util.format("\nSuccessfully submitted chaincode invoke transaction: request=%j, response=%j", invokeRequest, results));
    });
    invokeTx.on('complete', function(results) {
        // Invoke transaction completed successfully
        console.log(util.format("\nSuccessfully completed chaincode invoke transaction: request=%j, response=%j", invokeRequest, results));
        query();
    });
    invokeTx.on('error', function(err) {
        // Invoke transaction submission failed
        console.log(util.format("\nFailed to submit chaincode invoke transaction: request=%j, error=%j", invokeRequest, err));
        process.exit(1);
    });

    //Listen to custom events
    var regid = eh.registerChaincodeEvent(chaincodeID, "evtsender", function(event) {
        console.log(util.format("Custom event received, payload: %j\n", event.payload.toString()));
        eh.unregisterChaincodeEvent(regid);
    });
}

function query() {
    var args = getArgs(config.queryRequest);
    // Construct the query request
    var queryRequest = {
        // Name (hash) required for query
        chaincodeID: chaincodeID,
        // Function to trigger
  //`      fcn: config.queryRequest.functionName,
        // Existing state variable to retrieve
        args: args
    };

    // Trigger the query transaction
    var queryTx = userObj.query(queryRequest);

    // Print the query results
    queryTx.on('complete', function(results) {
        // Query completed successfully
        console.log("\nSuccessfully queried  chaincode function: request=%j, value=%s", queryRequest, results.result.toString());
        process.exit(0);
    });
    queryTx.on('error', function(err) {
        // Query failed
        console.log("\nFailed to query chaincode, function: request=%j, error=%j", queryRequest, err);
        process.exit(1);
    });
}

function getArgs(request) {
    var args = [];
    for (var i = 0; i < request.args.length; i++) {
        args.push(request.args[i]);
    }
    return args;
}

function fileExists(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch (err) {
        return false;
    }
}
