var fs = require('fs'),
    os = require('os'),
    azureStorage = require('azure-storage'),
    exec = require('child_process').exec, 
    logger = require('./logger.js');

var log = logger.LOG;
//var name = "garstoragewarm6";
//var key = "1gyztSLr7QcnCGPTfhesqFTXYdH2DY69SgT1KU7RaU5IFOiePyxcPfroR0rXkW+Ivj9qCZT2vwdyw4oHgiDftQ==";
//var tableName = 'diagnosticsTable';
var hostname = process.env.HOST_VM;
var tableSvc;

function StorageOperations(accountName, accessKey, tableName) {
    if (accountName === null || accountName === undefined) {
        throw new Error('Stroage account name cannot be null.');
    }
    
    if (accessKey === null || accessKey === undefined) {
        throw new Error('Storage access key cannot be null.');
    }
    
    if (tableName === null || tableName === undefined) {
        throw new Error('Table name cannot be null.');
    }
    this.accountName = accountName;
    this.accessKey = accessKey;
    this.tableName = tableName;
};

StorageOperations.prototype.readTable = function (callback) {
    try {
        tableSvc = azureStorage.createTableService(this.accountName, this.accessKey);
        var query = new azureStorage.TableQuery().select(['RowKey', 'Percentage']).where('PartitionKey eq ?', 'CpuUsage');
        
        tableSvc.queryEntities(this.tableName, query, null , function (error, result, response) {
            if (error) {
                return callback(error.message, null);
            }
            log.info('Storage read status:' + response.statusCode);
            if (response.statusCode === 200 || response.statusCode === 204) {
                return callback(null, result.entries);
            }
            else {
                err = new Error('ERROR CODE' + response.statusCode);
                return callback(err, null);
            }
        });
    } catch (e) {
        callback(e.message, null);
    }
}

StorageOperations.prototype.writeTable = function (usage, resourceGroup, callback) {
    try {
        tableSvc = azureStorage.createTableService(this.accountName, this.accessKey);
        tableSvc.tableName = this.tableName;
        log.info("Table name : " + tableSvc.tableName);
        tableSvc.createTableIfNotExists(tableSvc.tableName, function (error, result, response) {
            if (error) {
                return callback(error.message, null);
            }
            log.info('Storage table exist, status:' + response.statusCode);
            if (response.statusCode === 200 || response.statusCode === 204) {
                //console.log(response.statusCode);
                
                if (hostname !== undefined) {
                    
                    insertEntity(usage, hostname, resourceGroup, function (err, result) {
                        if (err) {
                            return callback(err);
                        }
                        
                    });
                } else {
                    var child = exec('hostname', function (error, stdout, stderr) {
                        if (error) {
                            //console.log(error);
                            return callback(error.message, null);
                        }
                        insertEntity(usage, stdout, resourceGroup, function (err, result) {
                            if (err) {
                                return callback(err);
                            }
                            
                        });
                    });
                }
            }
            else {
                err = new Error('Error status code:' + response.statusCode);
                return callback(err, null);
            }
        });
    } catch (e) {
        callback(e.message, null);
    }
}

var insertEntity = function (usage, hostname, resourceGroup, callback) {
    try {
        var host = hostname.replace(/\n|\r/g, '');
        log.info('Enter entities for hostname: ' + host);
        log.info('Usage:' + usage);
        
        var entGen = azureStorage.TableUtilities.entityGenerator;
        var entity = {
            PartitionKey: entGen.String('CpuUsage'),
            RowKey: entGen.String(host),
            Percentage: entGen.Double(usage),
            ResourceGroup : entGen.String(resourceGroup),
            complexDateValue: entGen.DateTime(new Date(Date.UTC(2013, 02, 16, 01, 46, 20)))
        };
        
        tableSvc.insertOrReplaceEntity(tableSvc.tableName, entity, function (error, result, response) {
            if (error) {
                //console.log(error);
                return callback(error.message, null);
            }
            log.info('Insert status code: ' + response.statusCode);
            //console.log(response.statusCode);
            return callback(null, response.statusCode);
                            
        });
    } catch (e) {
        callback(e.message, null);
    }
}

//var t = new StorageOperations(name, key, tableName);
//t.writeTable(45, function (err, result) {
//    console.log(result);
//    console.log(err);
//});

//t.readTable(function (err, result) {
//    console.log(result);
//    console.log(err);
//});
exports.StorageOperations = StorageOperations;
