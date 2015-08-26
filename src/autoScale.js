var fs = require('fs'),
    events = require('events'),
    adal = require('adal-node'),
    os = require('os'),
    https = require('https'),
    path = require('path'),
    resourceManagement = require("azure-arm-resource"),
    common = require("azure-common");

var templateOperations = require('./templateOperations'),
    storageOperations = require('./storageOperations'),
    logger = require('./logger.js');

var tableName = 'diagnosticsTable';

var intervalId;
var intervalIdDeploymentStatus;
var timerId;
var self;
var fileDir = path.normalize('.//files');
var log = logger.LOG;
var i;

var AutoscaleAgentOperations = (function (configFileUrl) {
    
    /*Constructor*/
    function AutoscaleAgentOperations(configFileUrl) {
        
        self = this;
        i = 0;
        timerId = null;
        intervalIdDeploymentStatus = null;
        intervalId = null;
        
        if (configFileUrl === null || configFileUrl === undefined) {
            log.error('Configuration file cannot be null.');
            return;
        }
        
        log.info('Configuartion file:' + configFileUrl);
        
        try {
            
            var inputJson = JSON.parse(fs.readFileSync(configFileUrl, 'utf8'));
            
            this.templateOperations = new templateOperations.TemplateOperations(inputJson.parameters.Autoscale.DeploymentTemplateURI,
                                inputJson.parameters.Autoscale.DeplymentParameterFileURI);
            console.log(this.templateOperations);
            this.storageOperations = new storageOperations.StorageOperations(inputJson.parameters.Credentials.StorageAccountName,
                                inputJson.parameters.Credentials.StorageAccessKey,
                                tableName);
            if (inputJson.parameters.Credentials.TenantId === null || inputJson.parameters.Credentials.TenantId === undefined) {
                log.error('TenantId cannot be null.');
                return;
            }
            if (inputJson.parameters.Credentials.ClientId === null || inputJson.parameters.Credentials.ClientId === undefined) {
                log.error('clientId cannot be null.');
                return;
            }
            if (inputJson.parameters.Credentials.ClientSecret === null || inputJson.parameters.Credentials.ClientSecret === undefined) {
                log.error('clientSecret cannot be null.');
                return;
            }
            if (inputJson.parameters.Credentials.SubscriptionId === null || inputJson.parameters.Credentials.SubscriptionId === undefined) {
                log.error('subscriptionId cannot be null.');
                return;
            }
            if (inputJson.parameters.Autoscale.ResourceGroup === null || inputJson.parameters.Autoscale.ResourceGroup === undefined) {
                log.error('resourceGroup cannot be null.');
                return;
            }
            if (inputJson.parameters.Autoscale.ThresholdPercentage.Upper === null || inputJson.parameters.Autoscale.ThresholdPercentage.Upper === undefined) {
                log.error('upperThreshold cannot be null.');
                return;
            }
            if (inputJson.parameters.Autoscale.NodeCount === null || inputJson.parameters.Autoscale.NodeCount === undefined/*|| inputJson.parameters.Credentials.count === 0*/) {
                log.error('upperThreshold cannot be null or 0');
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
            log.error(e.message);
            return;
        }
       
        // check if its json.
        
    }
    
    AutoscaleAgentOperations.prototype.init = function () {
        log.info('Starting Autoscale agent...');
        
        self.templateOperations.getDeploymentTemplate(function (err, template) {
            
            if (err) {
                log.error(err.message);
                return;
            }
            try {
                log.info('Created and saved deployment template.');
                self.template = template;
                waitForSlaves(template.properties.parameters.slaveCount.value, function (err, result) {
                    log.info('All slaves are up now, started monitoring.');
                    monitorStorage(function (err, result) {
                        if (err) {
                            log.error(err.message);
                            
                            if (intervalId)
                                clearInterval(intervalId);
                            if (intervalIdDeploymentStatus)
                                clearInterval(intervalIdDeploymentStatus);
                            return;
                        }
                    });
                });
            } catch (e) {
                if (intervalId)
                    clearInterval(intervalId);
                if (intervalIdDeploymentStatus)
                    clearInterval(intervalIdDeploymentStatus);
                log.error(e.message);
                return;
            }
        });
    }
    
    function waitForSlaves(slaveCount, callback) {
        log.info('Waiting for the nodes to spin up.');
        var intId = setInterval(function () {
            self.storageOperations.readTable(function (err, storageEntries) {
                if (err) {
                    clearInterval(intId);
                    return callback(err, null);
                }
                log.info('# of slaves up are:' + storageEntries.length + ', Autoscaling starts when ' + slaveCount + ' nodes are ready');
                if (storageEntries.length === slaveCount) {
                    clearInterval(intId);
                    return callback(null);
                }
            });
        }, 5000);
    }
    
    function monitorStorage(callback) {
        var intervalId = setInterval(function () {
            self.storageOperations.readTable(function (err, percentage) {
                if (err) {
                    clearInterval(intervalId);
                    return callback(err, null);
                }
                
                try {
                    var p = calculateAverageCpuLoad(percentage);
                    if (p > self.upperThreshold) {
                        log.warn('Cpu usage(%): ' + p);
                        i++;
                    } else {
                        log.info('Cpu usage(%): ' + p);
                        i--;
                        if (i < 0)
                            i = 0;
                    }
                    
                    //log.info('CPU usage of the cluster at this time:' + p);
                    var scaling = new events.EventEmitter();
                    if (i >= 3) {
                        i = 0;
                        log.info('Scalign up the cluster.');
                        clearInterval(intervalId);  //clear monitoring timeout
                        scaling.on('scaleup', function () {
                            scaleUp(self.count, self.template, function (err, result) {
                                if (err) {
                                    return callback(err, null);
                                }
                            });
                        });  // call scaleup
                        scaling.emit('scaleup');
                    }
                } catch (e) {
                    callback(e, null);
                }
            });
        }, 10000);  //monitoring storage
    }
    
    function scaleUp(count, template, callback) {
        try {
            template.properties.parameters.slaveCount.value = template.properties.parameters.slaveCount.value + count; // creating template
            
            log.info('Total slaves after scaling operation: ' + template.properties.parameters.slaveCount.value);
            //console.log('count:' + template.properties.parameters.Count.value);
            getToken(function (err, token) {
                if (err) {
                    return callback(err, null);
                }
                try {
                    var resourceManagementClient = getResourceManagementClient(self.subscriptionId, token);
                    self.deploymentName = "Testdeployment" + getRandomInt(1, 100000);
                    
                    resourceManagementClient.deployments.createOrUpdate(self.resourceGroup, self.deploymentName, template , function (err, result) {
                        if (err) {
                            return callback(err, null);
                        }
                        try {
                            log.info('Deploying ' + self.deploymentName+',Status code: '+ result.statusCode);
                         
                            intervalIdDeploymentStatus = setInterval(function () {
                                checkDeploymentStatus(function (err, result) {
                                    if (err) {
                                        return callback(err, null);
                                    }
                                    
                                    if (result === 'Succeeded') {
                                        clearInterval(intervalIdDeploymentStatus);
                                        fs.writeFileSync(self.templateOperations.deploymentTemplate, JSON.stringify(template, null, 4));
                                        log.info(self.deploymentName + 'Succeeded, Status code: ' + result.statusCode);
                                        setTimeout(function () {
                                            console.log("Setting timeout for stablizing the CPU usage for scaling up operation.");
                                            self.init();
                                        }, 120000);
                                    }

                                });
                            }, 60000); //check status periodically
                        } catch (e) {
                            callback(e, null);
                        }
                    });
                } catch (e) {
                    return callback(e, null);
                }
            });
        } catch (e) {
            return callback(e, null);
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
    
    var getToken = function (callback) {
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
    
    function checkDeploymentStatus(callback) {
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
                    log.info("Status code:" + data.statusCode);
                    if (data.deployment.properties.provisioningState === 'Running' || data.deployment.properties.provisioningState === 'Accepted') {
                        log.info('Deployment status:' + data.deployment.properties.provisioningState);
                    } else if (data.deployment.properties.provisioningState === 'Failed') {
                        return callback(new Error('Deployment Failed'));
                    } else {
                        return callback(null, data.deployment.properties.provisioningState);
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
        //console.log(stats);
        return stats;
    }
    
    function writeUsageToStorage(callback) {
        try {
            //log.info('CALCULATING CPU USAGE..');
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
                    self.storageOperations.writeTable(self.cpuUsage, self.resourceGroup, function (err, result) {
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
                writeUsageToStorage(function (err, result) {
                    if (err) {
                        if (timerId)
                            clearTimeout(timerId);
                        if (intervalId)
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



function start() {
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
                //console.log('name' + name);
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
