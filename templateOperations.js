var fs = require("fs"),
    https = require("https"),
    path = require('path');



//var templateUri = 'https://raw.githubusercontent.com/garimakhulbe/azure-template/master/Auto-scaling/testautoscale.json';
//var parameterUri = 'https://raw.githubusercontent.com/garimakhulbe/azure-template/master/Auto-scaling/azureparameters.json';

var deploymentTemplate = 'deploymentTemplate.json';
var fileDir = './/files';
var self;

function TemplateOperations(templateUri, parameterUri) {
    if (templateUri === null || templateUri === undefined) {
        throw new Error('TemplateUri cannot be null.');
    }
    
    if (parameterUri === null || parameterUri === undefined) {
        throw new Error('parameterUri cannot be null.');
    }
    this.templateUri = templateUri;
    this.parameterUri = parameterUri;
    this.deploymentTemplate = path.normalize(fileDir + '//' + deploymentTemplate);
};



TemplateOperations.prototype.getDeploymentTemplate = function (callback) {
    self = this;
    
    try {
        if (!fs.existsSync(self.deploymentTemplate)) {
            
            downloadJson(self.templateUri, 'template', function (err, templateFilePath) {
                if (err) {
                    return callback(err.message, null);
                }
                
                downloadJson(self.parameterUri, 'parameter', function (err, parameterFilePath) {
                    if (err) {
                        return callback(err.message, null);
                    }
                    
                    try {
                        //console.log(parameterFilePath)
                        var jsonTemplateObj = JSON.parse(fs.readFileSync(templateFilePath, 'utf8'));
                        var jsonParameterObj = JSON.parse(fs.readFileSync(parameterFilePath, 'utf8'));
                        
                        var armTemplate = {
                            "properties": {
                                "template": jsonTemplateObj,
                                "mode": "Complete",
                                "parameters": jsonParameterObj.parameters
                            }
                        }
                        
                        //console.log('ARM'+armTemplate);
                        
                        fs.writeFileSync(self.deploymentTemplate, JSON.stringify(armTemplate, null, 4));
                        var template = JSON.parse(fs.readFileSync(self.deploymentTemplate, 'utf8'));
                        callback(null, template);
                    } catch (e) {
                        callback(e, null);
                    }
                
                });
            });
        }
        else {
            var template = JSON.parse(fs.readFileSync(self.deploymentTemplate, 'utf8'));
            callback(null, template);
        }
    } catch (e) {
        callback(e, null);
    }
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



//var t = new TemplateOperations(templateUri, parameterUri);
//t.getDeploymentTemplate(function (err, template) {
//    console.log(template);
//    console.log('ERR'+err);
//});


exports.TemplateOperations = TemplateOperations;
