'use strict';

var g = require('./globalize');
var url = require('url'),
  fs = require('fs'),
  path = require('path'),
  compress = null,
  events = require('events'),
  XMLHandler = require('./parser/xmlHandler'),
  Base = require('./base'),
  toXMLDate = require('./utils').toXMLDate,
  util = require('util'),
  debug = require('debug')('strong-soap:server'),
  parser = require('./parser/index'),
  debugDetail = require('debug')('strong-soap:server:detail');

try {
  compress = require('compress');
} catch (error) {
  // Ignore error
}

class SoapHandler extends Base{

// constructor de strong-soap
// constructor(server, path, services, wsdl, options) {
//     super(wsdl, options);
//     var self = this;
//     options = options || {};
//     this.path = path;
//     this.services = services;

//     debug('Server parameters: path: %s services: %j wsdl: %j', path, services, wsdl);
//     if (path[path.length - 1] !== '/')
//       path += '/';
//     wsdl.load(function(err) {
//       if (err) throw err;
//       self.xmlHandler = new XMLHandler(self.wsdl.definitions.schemas, self.wsdl.options);
//       var listeners = server.listeners('request').slice();

//       server.removeAllListeners('request');
//       server.addListener('request', function(req, res) {
//         if (typeof self.authorizeConnection === 'function') {
//           if (!self.authorizeConnection(req.connection.remoteAddress)) {
//             res.end();
//             return;
//           }
//         }
//         var reqPath = url.parse(req.url).pathname;
//         if (reqPath[reqPath.length - 1] !== '/')
//           reqPath += '/';
//         if (path === reqPath) {
//           self._requestListener(req, res);
//         } else {
//           for (var i = 0, len = listeners.length; i < len; i++) {
//             listeners[i].call(this, req, res);
//           }
//         }
//       });
//     });
//   }

//constructor de lambda-soap

//   constructor(config) {
//     this.services = {};
//     if (config.services && typeof config.services === 'function') {
//       Object.assign(this.services, config.services());
//       for (const service in this.services) {
//         if (Object.prototype.hasOwnProperty.call(this.services, service)) {
//           try {
//             // get the
//             this.services[service].wsdl = fs
//                 .readFileSync(
//                     path.resolve(this.services[service].wsdlPath),
//                     'utf-8',
//                 )
//                 .toString();
//           } catch (error) {
//             throw new Error(
//                 'Cannot read the wsdl file: ' + this.services[service].wsdlPath,
//             );
//           }
//           if (parser.validate(this.services[service].wsdl) !== true) {
//             throw new Error(
//                 'Cannot parse the wsdl file correctly: ' +
//                 this.services[service].wsdlPath,
//             );
//           }
//         }
//       }
//     }
//   }

constructor(services, wsdlPath, options) {

    const xml = fs.readFileSync(path.resolve(wsdlPath), 'utf-8').toString();

    var wsdl = new parser.WSDL(xml || services, null, {});
    super(wsdl, options);
    options = options || {};
    var self = this;
    this.services = services;

    Object.keys(this.services).keys((key) => console.log(`Service: ${key}`));

    wsdl.load(function(err) {
        if (err) throw err;
        self.xmlHandler = new XMLHandler(self.wsdl.definitions.schemas, self.wsdl.options);
    });
}

  /**
   * Create the lambda handler
   *
   * @param {Object} options options object to create a lambda handler
   * @return {function} a lambda handler to handle the incoming event
   */

  
  createHandler(options) {
    return async (event, context,) => {

      console.log('🔸event', event);
      if (this.services.hasOwnProperty(event.pathParameters.proxy)) {
        if (
          event.httpMethod === 'GET' &&
          event.queryStringParameters.hasOwnProperty('wsdl')
        ) {
          return {
            body: self.wsdl.toXML(),
            statusCode: 200,
            headers: {
              'Content-Type': 'application/xml',
            },
          };
        } else if (event.httpMethod === 'POST') {
          try {
            const result = await self._processPromisify(xml, req);
            return {
                body: result,
                statusCode: 200,
                headers: {
                  'Content-Type': 'application/xml',
                },
              };
          } catch (error) {
            return {
                statusCode: 500,
                headers: {
                  'Content-Type': 'application/xml',
                },
            };
          }
        }
      } else {
        return {
          body: JSON.stringify(event),
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        };
      }
    };
  }

  _processPromisify(input, req) {
      return new Promise((resolve, reject) => {
        this._process(input, req, () => {

        })
      })
  }
  _process(input, req, callback) {
    var self = this,
      pathname = url.parse(req.url).pathname.replace(/\/$/, ''),
      obj = this.xmlHandler.xmlToJson(null, input),
      body = obj.Body,
      headers = obj.Header,
      bindings = this.wsdl.definitions.bindings, binding,
      operation, operationName,
      serviceName, portName,
      includeTimestamp = obj.Header && obj.Header.Security &&
        obj.Header.Security.Timestamp;

    if (typeof self.authenticate === 'function') {
      if (!obj.Header || !obj.Header.Security) {
        throw new Error(g.f('No security header'));
      }
      if (!self.authenticate(obj.Header.Security)) {
        throw new Error(g.f('Invalid username or password'));
      }
    }
    // use port.location and current url to find the right binding
    binding = (function(self) {
      var services = self.wsdl.definitions.services;
      var firstPort;
      var name;
      for (name in services) {
        serviceName = name;
        var service = services[serviceName];
        var ports = service.ports;
        for (name in ports) {
          portName = name;
          var port = ports[portName];
          var portPathname = url.parse(port.location).pathname.replace(/\/$/, '');

          if (portPathname === pathname)
            return port.binding;

          // The port path is almost always wrong for generated WSDLs
          if (!firstPort) {
            firstPort = port;
          }
        }
      }
      return !firstPort ? void 0 : firstPort.binding;
    })(this);

    if (!binding) {
      throw new Error(g.f('Failed to bind to {{WSDL}}'));
    }

    try {
      if (binding.style === 'rpc') {
        operationName = Object.keys(body)[0];

        self.emit('request', obj, operationName);
        if (headers)
          self.emit('headers', headers, operationName);

        self._executeMethod({
          serviceName: serviceName,
          portName: portName,
          operationName: operationName,
          outputName: operationName + 'Response',
          args: body[operationName],
          headers: headers,
          style: 'rpc'
        }, req, callback);
      } else { //document style
        var messageElemName = (Object.keys(body)[0] === 'attributes' ?
          Object.keys(body)[1] : Object.keys(body)[0]);
        var pair = binding.topElements[messageElemName];

        var operationName, outputName;
        var operations = binding.operations;
        //figure out the output name
        for (var name in operations) {
          var inputParts = operations[name].input.message.parts;
          //find the first part of the input message. There could be more than one parts in input message.
          var firstInPart = inputParts[Object.keys(inputParts)[0]];
          if(firstInPart.element.$name === messageElemName) {
            operationName = operations[name].$name;
            if (operations[name].output != null) {
              var outPart = operations[name].output.message.parts;
              //there will be only one output part
              var firstOutPart = outPart[Object.keys(outPart)[0]];
              outputName = firstOutPart.element.$name;
            }
            break;
          }
        }

        self.emit('request', obj, operationName);
        if (headers)
          self.emit('headers', headers, operationName);

        self._executeMethod({
          serviceName: serviceName,
          portName: portName,
          operationName: operationName,
          outputName: outputName,
          args: body[messageElemName],
          headers: headers,
          style: 'document',
          includeTimestamp: includeTimestamp
        }, req, callback);
      }
    } catch (error) {
      if (error.Fault !== undefined) {
        return self._sendError(operations[name], error, callback, includeTimestamp);
      }
      //Revisit - is this needed?
      throw error;
    }
  };

  _executeMethod(options, req, callback) {
    options = options || {};
    var self = this,
      operation, body,
      serviceName = options.serviceName,
      portName = options.portName,
      operationName = options.operationName,
      outputName = options.outputName,
      args = options.args,
      style = options.style,
      includeTimestamp = options.includeTimestamp,
      handled = false;

    try {
      operation = this.services[serviceName][portName][operationName];
      debug('Server operation: %s ', operationName);
    } catch (error) {
      debug('Server executeMethod: error: %s ', error.message);
      //fix - should create a fault and call sendError (..) so that this error is not lost and will be sent as Fault in soap envelope
      //to the client?
      return callback(this._envelope('', includeTimestamp));
    }

    function handleResult(error, result) {
      if (handled)
        return;
      handled = true;

      var operation  = self.wsdl.definitions.services[serviceName]
        .ports[portName].binding.operations[operationName];


      if (error && error.Fault !== undefined) {
        return self._sendError(operation, error, callback, includeTimestamp);
      }
      else if (result === undefined) {
        // Backward compatibility to support one argument callback style
        result = error;
      }

      var element = operation.output;

      var operationDescriptor = operation.describe(self.wsdl.definitions);
      debugDetail('Server handleResult. operationDescriptor: %j ', operationDescriptor);

      var outputBodyDescriptor = operationDescriptor.output.body;
      debugDetail('Server handleResult. outputBodyDescriptor: %j ', outputBodyDescriptor);

      var soapNsURI = 'http://schemas.xmlsoap.org/soap/envelope/';
      var soapNsPrefix = self.wsdl.options.envelopeKey || 'soap';

      if (operation.soapVersion === '1.2') {
        soapNsURI = 'http://www.w3.org/2003/05/soap-envelope';
      }

      debug('Server soapNsURI: %s soapNsPrefix: %s', soapNsURI, soapNsPrefix);

      var nsContext = self.createNamespaceContext(soapNsPrefix, soapNsURI);
      var envelope = XMLHandler.createSOAPEnvelope(soapNsPrefix, soapNsURI);


      self.xmlHandler.jsonToXml(envelope.body, nsContext, outputBodyDescriptor, result);

      self._envelope(envelope, includeTimestamp);
      var message = envelope.body.toString({pretty: true});
      var xml = envelope.doc.end({pretty: true});

      debug('Server handleResult. xml: %s ', xml);
      callback(xml);

    }

    if (!self.wsdl.definitions.services[serviceName].ports[portName]
        .binding.operations[operationName].output) {
      // no output defined = one-way operation so return empty response
      handled = true;
      callback('');
    }

    var result = operation(args, handleResult, options.headers, req);
    if (typeof result !== 'undefined') {
      handleResult(null, result);
    }
  };

  _addWSSecurityHeader(headerElement) {
    var secElement = headerElement.element('wsse:Security')
      .attribute('soap:mustUnderstand', '1');

    secElement
      .attribute('xmlns:wsse', 'http://docs.oasis-open.org/wss/2004/01/' +
        'oasis-200401-wss-wssecurity-secext-1.0.xsd')
      .attribute('xmlns:wsu', 'http://docs.oasis-open.org/wss/2004/01/' +
        'oasis-200401-wss-wssecurity-utility-1.0.xsd');

    var now = new Date();
    var created = toXMLDate(now);
    var timeStampXml = '';

    var expires = toXMLDate(new Date(now.getTime() + (1000 * 600)));

    var tsElement = secElement.element('wsu:Timestamp')
      .attribute('wsu:Id', 'Timestamp-' + created);
    tsElement.element('wsu:Created', created);
    tsElement.element('wsu:Expires', expires);

  }

  _envelope(env, includeTimestamp) {
    env = env || XMLHandler.createSOAPEnvelope();

    if (includeTimestamp) {
      this._addWSSecurityHeader(env.header);
    }

    var soapHeaderElement = env.header;
    //add soapHeaders to envelope. Header can be xml, or JSON object which may or may not be described in WSDL/XSD.
    this.addSoapHeadersToEnvelope(soapHeaderElement, this.xmlHandler);
    return env;
  };

  _sendError(operation, error, callback, includeTimestamp) {
    var self = this,
      fault;

    var statusCode;
    if (error.Fault.statusCode) {
      statusCode = error.Fault.statusCode;
      error.Fault.statusCode = undefined;
    }

    var operationDescriptor = operation.describe(this.wsdl.definitions);
    debugDetail('Server sendError. operationDescriptor: %j ', operationDescriptor);

    //get envelope descriptor
    var faultEnvDescriptor = operation.descriptor.faultEnvelope.elements[0];


    var soapNsURI = 'http://schemas.xmlsoap.org/soap/envelope/';
    var soapNsPrefix = self.wsdl.options.envelopeKey || 'soap';

    if (operation.soapVersion === '1.2') {
      soapNsURI = 'http://www.w3.org/2003/05/soap-envelope';
    }

    var nsContext = self.createNamespaceContext(soapNsPrefix, soapNsURI);
    var envelope = XMLHandler.createSOAPEnvelope(soapNsPrefix, soapNsURI);


    //find the envelope body descriptor
    var bodyDescriptor = faultEnvDescriptor.elements[1];

    //there will be only one <Fault> element descriptor under <Body>
    var faultDescriptor = bodyDescriptor.elements[0];
    debugDetail('Server sendError. faultDescriptor: %j ', faultDescriptor);

    debug('Server sendError.  error.Fault: %j ',  error.Fault);

    //serialize Fault object into XML as per faultDescriptor
    this.xmlHandler.jsonToXml(envelope.body, nsContext, faultDescriptor, error.Fault);

    self._envelope(envelope, includeTimestamp);
    var message = envelope.body.toString({pretty: true});
    var xml = envelope.doc.end({pretty: true});

    debug('Server sendError. Response envelope: %s ', xml);
    callback(xml, statusCode);
  }
}

module.exports = SoapHandler;