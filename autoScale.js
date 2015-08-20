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


var AutoscaleAgentOperations = (function (configFileUrl) {
    
    /*Constructor*/
    function AutoscaleAgentOperations(configFileUrl) {
        
        if (configFileUrl === null || configFileUrl === undefined) {
            console.log('Configuration file cannot be null.');
            return;
        }
        self = this;
        console.log(configFileUrl);
      
        try {
            
            var inputJson = JSON.parse(fs.readFileSync(configFileUrl, 'utf8'));
            
            this.templateOperations = new templateOperations.TemplateOperations(inputJson.parameters.Autoscale.DeploymentTemplateURI,
                                inputJson.parameters.Autoscale.DeplymentParameterFileURI);
            console.log(this.templateOperations);
            this.storageOperations = new storageOperations.StorageOperations(inputJson.parameters.Credentials.StorageAccountName,
                                inputJson.parameters.Credentials.StorageAccessKey,
                                tableName);
            if (inputJson.parameters.Credentials.TenantId === null || inputJson.parameters.Credentials.TenantId === undefined) {
                console.log('TenantId cannot be null.');
                return;
            }
            if (inputJson.parameters.Credentials.ClientId === null || inputJson.parameters.Credentials.ClientId === undefined) {
                console.log('clientId cannot be null.');
                return;
            }
            if (inputJson.parameters.Credentials.ClientSecret === null || inputJson.parameters.Credentials.ClientSecret === undefined) {
                console.log('clientSecret cannot be null.');
                return;
            }
            if (inputJson.parameters.Credentials.SubscriptionId === null || inputJson.parameters.Credentials.SubscriptionId === undefined) {
                console.log('subscriptionId cannot be null.');
                return;
            }
            if (inputJson.parameters.Autoscale.ResourceGroup === null || inputJson.parameters.Autoscale.ResourceGroup === undefined) {
                console.log('resourceGroup cannot be null.');
                return;
            }
            if (inputJson.parameters.Autoscale.ThresholdPercentage.Upper === null || inputJson.parameters.Autoscale.ThresholdPercentage.Upper === undefined) {
                console.log('upperThreshold cannot be null.');
                return;
            }
            if (inputJson.parameters.Autoscale.NodeCount === null || inputJson.parameters.Autoscale.NodeCount === undefined/*|| inputJson.parameters.Credentials.count === 0*/) {
                console.log('upperThreshold cannot be null or 0');
                return;
            }
            this.tenant = inputJson.parameters.Credentials.TenantId;
            this.clientId = inputJson.parameters.Credentials.ClientId;
            this.clientSecret = inputJson.parameters.Credentials.ClientSecret;
            this.subscriptionId = inputJson.parameters.Credentials.SubscriptionId;
            this.resourceGroup = inputJson.parameters.Autoscale.ResourceGroup;
            this.upperThreshold = inputJson.parameters.Autoscale.ThresholdPercentage.Upper;
            this.count = inputJson.parameters.Autoscale.NodeCount;
            
        } catch (e) {
            console.log(e.message);
            return;
        }
       
        // check if its json.
        
    }
    
    AutoscaleAgentOperations.prototype.init = function () {
        console.log('Checking the resource group status');
        console.log('Starting Autoscale agent...');
        self.templateOperations.getDeploymentTemplate(function (err, template) {
            if (err) {
                console.log(err.message);
                return;
            }
            try {
                self.template = template;
                intervalId = setInterval(function () {
                    monitorStorage(function (err, result) {
                        if (err) {
                            console.log(err);
                            if (intervalId)
                                clearInterval(intervalId);
                            if (intervalIdDeploymentStatus)
                                clearinterval(intervalIdDeploymentStatus);
                            return;
                        }
                  });
                }, 10000);  //monitoring storage
            } catch (e) {
                if (intervalId)
                    clearInterval(intervalId);
                if (intervalIdDeploymentStatus)
                    clearinterval(intervalIdDeploymentStatus);
                console.log(e.message);
                return;
            }
        });
    }
    
    function monitorStorage(callback) {
        console.log('Monitoring storage for CPU usage...');
        self.storageOperations.readTable(function (err, percentage) {
            if (err) {
                return callback(err, null);
            }
            try {
                p = calculateAverageCpuLoad(percentage);
                console.log('Percentage:'+p);
                var scaling = new events.EventEmitter();
                if (p > self.upperThreshold) {
                    console.log('Scaling up...');
                    clearInterval(intervalId);  //clear monitoring timeout
                    scaling.on('scaleup', function () {
                        scaleUp(self.count, self.template, function (err, result) {
                            if (err) {
                                console.log(err);
                                if (intervalId)
                                    clearInterval(intervalId);
                                if(intervalIdDeploymentStatus)
                                    clearinterval(intervalIdDeploymentStatus);
                                return callback(err, null);
                            }
                        });
                    });  // call scaleup
                    scaling.emit('scaleup');
                }
            } catch (e) {
                if (intervalId)
                    clearInterval(intervalId);
                if (intervalIdDeploymentStatus)
                    clearinterval(intervalIdDeploymentStatus);
                callback(e, null);
            }
        });  
    }
    
    function scaleUp(count, template, callback) {
        try {
            template.properties.parameters.slaveCount.value = template.properties.parameters.slaveCount.value + count; // creating template
            fs.writeFileSync(self.templateOperations.deploymentTemplate, JSON.stringify(template, null, 4));
            console.log('Slave count:' + template.properties.parameters.slaveCount.value);
            //console.log('count:' + template.properties.parameters.Count.value);
            getToken(function (err, token) {
                if (err) {
                    return callback(err, null);
                }
                try {
                    var resourceManagementClient = getResourceManagementClient(self.subscriptionId, token);
                    self.deploymentName = "Testdeployment" + getRandomInt(1, 100000);
                    console.log('Deploying ' + self.deploymentName);
                    resourceManagementClient.deployments.createOrUpdate(self.resourceGroup, self.deploymentName, template , function (err, result) {
                        if (err) {
                            return callback(err, null);
                        }
                        try {
                            intervalIdDeploymentStatus = setInterval(function () {
                                getDeploymentStatus(function (err, result) {
                                    if (err) {
                                        if (intervalId)
                                            clearInterval(intervalId);
                                        if (intervalIdDeploymentStatus)
                                            clearinterval(intervalIdDeploymentStatus);
                                        return callback(err, null);
                                    }
                                });
                            }, 60000); //check status periodically
                        } catch (e) {
                            if (intervalId)
                                clearInterval(intervalId);
                            if (intervalIdDeploymentStatus)
                                clearinterval(intervalIdDeploymentStatus);
                            callback(e, null);
                        }
                    });
                } catch (e) {
                    if (intervalId)
                        clearInterval(intervalId);
                    if (intervalIdDeploymentStatus)
                        clearinterval(intervalIdDeploymentStatus);
                    callback(e, null);
                }
            });
        } catch (e) {
            if (intervalId)
                clearInterval(intervalId);
            if (intervalIdDeploymentStatus)
                clearinterval(intervalIdDeploymentStatus);
            callback(e, null);
        }
    }
    
    
    function calculateAverageCpuLoad(percentageArray) {
        var percentage = [];
        for (var i = 0; i < percentageArray.length; i++) {
            var x = JSON.stringify(percentageArray[i].Percentage);
            var str = x.replace(/['"]+/g, '').toString();
            percentage[i] = parseFloat(str.split(':')[1].replace("}", ""));
        }
        
        var sum = 0.0;
        for (var j = 0; j < percentage.length; j++) {
            sum += percentage[j];
        }
        
        return (sum / percentage.length);
    }
    
    var getToken = function(callback) {
        var AuthenticationContext = adal.AuthenticationContext;
        var authorityHostUrl = 'https://login.windows.net';
        var authorityUrl = authorityHostUrl + '/' + self.tenant;
        var resource = 'https://management.azure.com/';
        var context = new AuthenticationContext(authorityUrl);
        context.acquireTokenWithClientCredentials(resource, self.clientId, self.clientSecret, function (err, tokenResponse) {
            if (err)
                return callback(err, null);
            callback(null, tokenResponse.accessToken);
        });
    }

    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    function getResourceManagementClient(subscriptionId, token) {
        var resourceManagementClient = resourceManagement.createResourceManagementClient(new common.TokenCloudCredentials({
            subscriptionId: subscriptionId,
            token: token
        }));
        return resourceManagementClient;
    }
    
    function getDeploymentStatus(callback) {
        getToken(function (err, token) {
            if (err) {
                return callback(err, null);
            }
            try {
                //console.log(token);
                var resourceManagementClient = getResourceManagementClient(self.subscriptionId, token);
                resourceManagementClient.deployments.get(self.resourceGroup, self.deploymentName, function (err, data) {
                    if (err) {
                        return callback(err, null);
                    }
                    if (data.deployment.properties.provisioningState === 'Running' || data.deployment.properties.provisioningState === 'Accepted') {
                        console.log('Deploying status:' + data.deployment.properties.provisioningState);
                    } else if (data.deployment.properties.provisioningState === 'Failed') {
                        throw new Error('Deployment Failed');
                    }
                    else {
                        clearInterval(intervalIdDeploymentStatus);
                        console.log('Deployment status ' + data.deployment.properties.provisioningState);
                        console.log("Setting timeout for system to settle down after scaling operation!!");
                        var timerId = setTimeout(function () {
                            clearTimeout(timerId);
                            console.log("Start Monitoring again!!");
                            intervalId = setInterval(function () {
                                monitorStorage(function (err, result) {
                                    if (err) {
                                        console.log('Monitor storage:' + err);
                                        if (intervalId)
                                            clearInterval(intervalId);
                                        if (intervalIdDeploymentStatus)
                                            clearinterval(intervalIdDeploymentStatus);
                                        return;
                                    }
                                });
                            }, 10000);
                        }, 120000);
            
                    }
                });
            } catch (e) {
                callback(e, null);
            }
        });
    }
    
    
    
    return AutoscaleAgentOperations;
})();


var AutoscaleNodeOperations = (function (configFileUrl) {

    function AutoscaleNodeOperations(configFileUrl) {
        
        if (configFileUrl === null || configFileUrl === undefined) {
            throw new Error('Configuration file cannot be null.');
        }
        self = this;
        // check if its json.
        
        
        try {
            var inputJson = JSON.parse(fs.readFileSync(configFileUrl, 'utf8'));
                
            this.storageOperations = new storageOperations.StorageOperations(inputJson.parameters.Credentials.StorageAccountName,
                                inputJson.parameters.Credentials.StorageAccessKey,
                                tableName);
        } catch (e) {
            console.log(e);
            return;
        }

    }

    function getStats() {
        var statFile = fs.readFileSync('/proc/stat', 'utf8');
        //console.log(statFile);
        var arr = statFile.split(os.EOL);
        //console.log(arr[0]);
        var stats = arr[0].split(/\s+/g, 5);
        console.log(stats);
        return stats;
    }

    function writeUsageToStorage(callback) {
        try {
            console.log('Calculating CPU load....');
            var stat1 = getStats();
            var stat2;
            timerId = setTimeout(function () {
                try {
                    clearTimeout(timerId);
                    stat2 = getStats();
                    //console.log(stat2);
                    var total1 = 0, total2 = 0, usage1 = 0, usage2 = 0;
                    for (var i = 1; i <= 4 ; i++) {
                        //console.log(stat1[i]);
                        total1 += parseInt(stat1[i]);
                        total2 += parseInt(stat2[i]);
                        if (i != 4) {
                            usage1 += parseInt(stat1[i]);
                            usage2 += parseInt(stat2[i]);
                        }
                    }
                    
                    self.cpuUsage = ((100 * (usage2 - usage1)) / (total2 - total1));
                    //console.log('ABS'+ Math.abs(self.cpuUsage));
                    self.storageOperations.writeTable(self.cpuUsage, function (err, result) {
                        if (err) {
                            console.log(err);
                            return callback(err, null);
                        }
                //console.log(result);
                    });
                } catch (e) {
                    return callback(e, null);
                }
            }, 5000);
        } catch (e) {
            return callback(e, null);
        }
    }

    AutoscaleNodeOperations.prototype.init = function () {
        try {
            intervalId = setInterval(function () {
                console.log('Next interval started');
                writeUsageToStorage(function (err, result) {
                    if (err) {
                        if(timerId)
                            clearTimeout(timerId);
                        if(intervalId)
                            clearInterval(intervalId);
                        return;
                    }
                });
            }, 20000);
        } catch (e) {
            if (timerId)
                clearTimeout(timerId);
            if (intervalId)
                clearInterval(intervalId);
            console.log(e);
        }
    }

    return AutoscaleNodeOperations;
})();



function start()
{
    var autoscale;
    console.log(process.argv[3]);
    downloadJson(process.argv[3], 'inputParameters', function (err, filename) {
        console.log(filename);
        if (process.argv[2] === 'agent') {
        autoscale = new AutoscaleAgentOperations(filename);
        autoscale.init();
        }
        else {
            autoscale = new AutoscaleNodeOperations(filename);
            autoscale.init();
        }
    });
}


function downloadJson(url, file, callback) {
    //console.log(url);
    https.get(url, function (res) {
        body = '';
        
        res.on('data', function (data) {
            body += data;
        });
        
        res.on('end', function () {
            try {
                fs.mkdirSync(fileDir);
            } catch (e) {
                if (e.code != 'EEXIST')
                    callback(e, null);
            }
            
            try {
                var name = fileDir + '//' + file + '.json';
                console.log('name' + name);
                fs.writeFileSync(name, body);
                callback(null, name);
            } catch (e) {
                callback(e, null);
            }
        });
        
        res.on('error', function () {
            return callback(error, null);
        });

    }).on('error', function (e) {
        console.error(e);
        callback(e, null);
    });
}


start();
