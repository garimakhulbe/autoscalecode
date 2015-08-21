var fs = require('fs'),
    os = require('os'),
    azureStorage = require('azure-storage'),
    exec = require('child_process').exec, 
    logger = require('./logger.js');

var log = logger.LOG;
var name = "garstoragewarm6";
var key = "1gyztSLr7QcnCGPTfhesqFTXYdH2DY69SgT1KU7RaU5IFOiePyxcPfroR0rXkW+Ivj9qCZT2vwdyw4oHgiDftQ==";
var tableName = 'diagnosticsTable';

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
        var tableSvc = azureStorage.createTableService(this.accountName, this.accessKey);
        var query = new azureStorage.TableQuery().select(['RowKey', 'Percentage']).where('PartitionKey eq ?', 'CpuUsage');
        
        tableSvc.queryEntities(this.tableName, query, null , function (error, result, response) {
            if (error) {
                //console.log(error.message);
                return callback(error.message, null);
            }
            log.info('Storage read status code:' + response.statusCode);
            if (response.statusCode === 200 || response.statusCode === 204) {
                return callback(null, result.entries);
            }
            else {
                err = new Error('Status code:' + response.statusCode);
                return callback(err, null);
            }
        });
    } catch (e) {
        callback(e.message, null);
    }
}

StorageOperations.prototype.writeTable = function (usage, callback) {
    try {
        var tableSvc = azureStorage.createTableService(this.accountName, this.accessKey);
        tableSvc.tableName = this.tableName;
        tableSvc.createTableIfNotExists(tableSvc.tableName, function (error, result, response) {
            if (error) {
                //console.log(error);
                return callback(error.message, null);
            }
            log.info('Storage write status code:' + response.statusCode);
            if (response.statusCode === 200 || response.statusCode === 204) {
                //console.log(response.statusCode);
                var child = exec('hostname', function (error, stdout, stderr) {
                    if (error) {
                        //console.log(error);
                        return callback(error.message, null);
                    }
                    
                    try {
                        var hostname = stdout.replace(/\n|\r/g, '');
                        //console.log(hostname);
                        console.log(usage);
                        var entGen = azureStorage.TableUtilities.entityGenerator;
                        var entity = {
                            PartitionKey: entGen.String('CpuUsage'),
                            RowKey: entGen.String(hostname),
                            Percentage: entGen.Double(usage),
                            dateValue: entGen.DateTime(new Date(Date.UTC(2011, 10, 25))),
                            complexDateValue: entGen.DateTime(new Date(Date.UTC(2013, 02, 16, 01, 46, 20)))
                        };
                        
                        tableSvc.insertOrReplaceEntity(tableSvc.tableName, entity, function (error, result, response) {
                            if (error) {
                                //console.log(error);
                                return callback(error.message, null);
                            }
                            log.info('Status code' + response.statusCode);
                            //console.log(response.statusCode);
                            callback(null, response.statusCode);
                            
                        });
                    } catch (e) {
                        callback(e.message, null);
                    }
                });
            }
            else {
                err = new Error('Status code:' + response.statusCode);
                return callback(err, null);
            }
        });
    } catch (e) {
        callback(e.message, null);
    }
}

var t = new StorageOperations(name, key, tableName);
t.writeTable(45, function (err, result) {
    console.log(result);
    console.log(err);
});

//t.readTable(function (err, result) {
//    console.log(result);
//    console.log(err);
//});
exports.StorageOperations = StorageOperations;
