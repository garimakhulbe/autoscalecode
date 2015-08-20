var fs = require('fs'),
    events = require('events'),
    adal = require('adal-node'),
    os = require('os'),
    https = require('https'),
    path = require('path'),
    resourceManagement = require("azure-arm-resource"),
    common = require("azure-common");

var templateOperations = require('./templateOperations'),
    storageOperations = require('./storageOperations');

var tableName = 'diagnosticsTable';

var intervalId;
var intervalIdDeploymentStatus;
var timerId;
var self;
var fileDir = path.normalize('.//files');
var resourcegroup = "TestRGIntern7";
var clientId = "3b249d2e-bfad-4f3e-801b-415da09f243c";
var clientSecret = "Abcd1234";
var tenant = "ebbec650-885d-427d-80a9-41cf0af41e9e";
var subscriptionId = "56b3fc4b-19d1-4495-a008-8b58ded69e1b";
var token = "Bearer  eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6Ik1uQ19WWmNBVGZNNXBPWWlKSE1iYTlnb0VLWSIsImtpZCI6Ik1uQ19WWmNBVGZNNXBPWWlKSE1iYTlnb0VLWSJ9.eyJhdWQiOiJodHRwczovL21hbmFnZW1lbnQuYXp1cmUuY29tLyIsImlzcyI6Imh0dHBzOi8vc3RzLndpbmRvd3MubmV0L2ViYmVjNjUwLTg4NWQtNDI3ZC04MGE5LTQxY2YwYWY0MWU5ZS8iLCJpYXQiOjE0NDAwOTA3ODEsIm5iZiI6MTQ0MDA5MDc4MSwiZXhwIjoxNDQwMDk0NjgxLCJ2ZXIiOiIxLjAiLCJ0aWQiOiJlYmJlYzY1MC04ODVkLTQyN2QtODBhOS00MWNmMGFmNDFlOWUiLCJvaWQiOiJkMjVlODFkYS1hYzg2LTRjYjYtYjEwYy00YThhNDkzN2M4MWIiLCJzdWIiOiJkMjVlODFkYS1hYzg2LTRjYjYtYjEwYy00YThhNDkzN2M4MWIiLCJpZHAiOiJodHRwczovL3N0cy53aW5kb3dzLm5ldC9lYmJlYzY1MC04ODVkLTQyN2QtODBhOS00MWNmMGFmNDFlOWUvIiwiYXBwaWQiOiIzYjI0OWQyZS1iZmFkLTRmM2UtODAxYi00MTVkYTA5ZjI0M2MiLCJhcHBpZGFjciI6IjEifQ.kXdmm5C5eA47jMfz2Vwr7mpVzo8IdWDZx2ywN9228IAe-D2WOPF8ZXM2g_5bJHKRaI5KMJXbWj8apDNyR-M__7vpLPsoeendAh-RVZba1CzutpM8hQ6W3BwXjdupviPwKSX28t0xX6nayO7LcxyWkSOiWneKMK0sJ-0Rm21Y3BUf4ffsA449IRX-YiyuafULAVzv_zPTYPQ4A5bkgqUKxF-0mEKcF2piVl7VAMSp7nYOke-XJMxRVbF-7KD0iSD4hi_cqm1mu6fVeFOnu44AdFYDL1jlajNuffZOhV-jZABipwk0tnexpG4OEpRK5Gquoe8UDsCAyQuZ3BhfVSKP7g";


function getResourceManagementClient(subscriptionId, token) {
    var resourceManagementClient = resourceManagement.createResourceManagementClient(new common.TokenCloudCredentials({
        subscriptionId: subscriptionId,
        token: token
    }));
    return resourceManagementClient;
}


function getRGProvisioningState(resourcegroup, callback) {
    getToken(function (err, token) {
        if (err) {
            return callback(err, null);
        }
        try {
            var resourceManagementClient = getResourceManagementClient(subscriptionId, token);
            var t = setInterval(function () {
                resourceManagementClient.resourceGroups.get(resourcegroup, function (err, result) {
                    if (err) {
                        return callback(err, null);
                    }
                    var statusCode = result.statusCode;
                    if (statusCode !== 200 && statusCode !== 201) {
                        var error = new Error(body);
                        error.statusCode = result.statusCode;
                        return callback(error);
                    }
                    console.log(result.resourceGroup.provisioningState);
                    provisioningState = result.resourceGroup.provisioningState;
                    if (provisioningState === 'Succeeded' || provisioningState === 'Failed') {
                        clearInterval(t);
                        callback(null, provisioningState);
                    }
                });
            },3000);
        } catch (e) {
        console.log(e);
        }
    });
}

function getToken(callback) {
    var AuthenticationContext = adal.AuthenticationContext;
    var authorityHostUrl = 'https://login.windows.net';
    var authorityUrl = authorityHostUrl + '/' + tenant;
    var resource = 'https://management.azure.com/';
    var context = new AuthenticationContext(authorityUrl);
    context.acquireTokenWithClientCredentials(resource, clientId, clientSecret, function (err, tokenResponse) {
        if (err)
            return callback(err, null);
        callback(null, tokenResponse.accessToken);
    });
}


getRGProvisioningState(resourcegroup, function (err, result) {
    if (err) {
        console.log(err);
        return;
    }
    
     abc(result);
});

function abc(result){
    console.log('ji'+result);
}
