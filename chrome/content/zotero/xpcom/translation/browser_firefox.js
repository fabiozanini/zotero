/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    
    You should have received a copy of the GNU General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

const BOMs = {
	"UTF-8":"\xEF\xBB\xBF",
	"UTF-16BE":"\xFE\xFF",
	"UTF-16LE":"\xFF\xFE",
	"UTF-32BE":"\x00\x00\xFE\xFF",
	"UTF-32LE":"\xFF\xFE\x00\x00"
}

Components.utils.import("resource://gre/modules/NetUtil.jsm");

/**
 * @class Manages the translator sandbox
 * @param {Zotero.Translate} translate
 * @param {String|window} sandboxLocation
 */
Zotero.Translate.SandboxManager = function(translate, sandboxLocation) {
	this.sandbox = new Components.utils.Sandbox(sandboxLocation);
	this.sandbox.Zotero = {};
	this._translate = translate;
	
	// import functions missing from global scope into Fx sandbox
	this.sandbox.XPathResult = Components.interfaces.nsIDOMXPathResult;
}

Zotero.Translate.SandboxManager.prototype = {
	/**
	 * Evaluates code in the sandbox
	 */
	"eval":function(code) {
		Components.utils.evalInSandbox(code, this.sandbox);
	},
	
	/**
	 * Imports an object into the sandbox
	 *
	 * @param {Object} object Object to be imported (under Zotero)
	 * @param {Boolean} passTranslateAsFirstArgument Whether the translate instance should be passed
	 *     as the first argument to the function.
	 */
	"importObject":function(object, passAsFirstArgument, attachTo) {
		if(!attachTo) attachTo = this.sandbox.Zotero;
		for(var key in (object.__exposedProps__ ? object.__exposedProps__ : object)) {
			let localKey;
			if(object.__exposedProps__) {
				localKey = object.__exposedProps__[key];
			} else {
				localKey = key;
			}
			
			// magical XPCSafeJSObjectWrappers for sandbox
			if(typeof object[localKey] === "function" || typeof object[localKey] === "object") {
				attachTo[localKey] = function() {
					var args = (passAsFirstArgument ? [passAsFirstArgument] : []);
					for(var i=0; i<arguments.length; i++) {
						args.push(typeof arguments[i] === "object" || typeof arguments[i] === "function" ? new XPCSafeJSObjectWrapper(arguments[i]) : arguments[i]);
					}
					
					return object[localKey].apply(object, args);
				};
				
				// attach members
				if(!(object instanceof Components.interfaces.nsISupports)) {
					this.importObject(object[localKey], passAsFirstArgument ? passAsFirstArgument : null, attachTo[localKey]);
				}
			} else {
				object[localKey] = object[localKey];
			}
		}
	}
}

/******* (Native) Read support *******/

Zotero.Translate.IO.Read = function(file, mode) {
	this.file = file;
	
	// open file
	this._rawStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
							  .createInstance(Components.interfaces.nsIFileInputStream);
	this._rawStream.init(file, 0x01, 0664, 0);
	
	// start detecting charset
	var charset = null;
	
	// look for a BOM in the document
	if(Zotero.isFx4) {
		var first4 = NetUtil.readInputStreamToString(this._rawStream, 4);
	} else {
		var binStream = Components.classes["@mozilla.org/binaryinputstream;1"].
								   createInstance(Components.interfaces.nsIBinaryInputStream);
		binStream.setInputStream(this._rawStream);
		var first4 = binStream.readByteArray(4);
		first4 = String.fromCharCode.apply(null, first4);
	}

	for(var possibleCharset in BOMs) {
		if(first4.substr(0, BOMs[possibleCharset].length) == BOMs[possibleCharset]) {
			this._charset = possibleCharset;
			break;
		}
	}
	
	if(this._charset) {
		// BOM found; store its length and go back to the beginning of the file
		this._bomLength = BOMs[this._charset].length;
		this._seekToStart();
	} else {
		// look for an XML parse instruction
		this._bomLength = 0;
		
		var sStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
					 .createInstance(Components.interfaces.nsIScriptableInputStream);
		sStream.init(this._rawStream);
		
		// read until we see if the file begins with a parse instruction
		const whitespaceRe = /\s/g;
		var read;
		do {
			read = sStream.read(1);
		} while(whitespaceRe.test(read))
		
		if(read == "<") {
			var firstPart = read + sStream.read(4);
			if(firstPart == "<?xml") {
				// got a parse instruction, read until it ends
				read = true;
				while((read !== false) && (read !== ">")) {
					read = sStream.read(1);
					firstPart += read;
				}
				
				const encodingRe = /encoding=['"]([^'"]+)['"]/;
				var m = encodingRe.exec(firstPart);
				if(m) {
					try {
						var charconv = Components.classes["@mozilla.org/charset-converter-manager;1"]
											   .getService(Components.interfaces.nsICharsetConverterManager)
											   .getCharsetTitle(m[1]);
						if(charconv) this._charset = m[1];
					} catch(e) {}
				}
				
				// if we know for certain document is XML, we also know for certain that the
				// default charset for XML is UTF-8
				if(!this._charset) this._charset = "UTF-8";
			}
		}
		
		// If we managed to get a charset here, then translators shouldn't be able to override it,
		// since it's almost certainly correct. Otherwise, we allow override.
		this._allowCharsetOverride = !!this._charset;		
		this._seekToStart();
		
		if(!this._charset) {
			// No XML parse instruction or BOM.
			
			// Check whether the user has specified a charset preference
			var charsetPref = Zotero.Prefs.get("import.charset");
			if(charsetPref == "auto") {
				// For auto-detect, we are basically going to check if the file could be valid
				// UTF-8, and if this is true, we will treat it as UTF-8. Prior likelihood of
				// UTF-8 is very high, so this should be a reasonable strategy.
				
				// from http://codex.wordpress.org/User:Hakre/UTF8
				const UTF8Regex = new RegExp('^(?:' +
					  '[\x09\x0A\x0D\x20-\x7E]' +        // ASCII
					  '|[\xC2-\xDF][\x80-\xBF]' +        // non-overlong 2-byte
					  '|\xE0[\xA0-\xBF][\x80-\xBF]' +    // excluding overlongs
					  '|[\xE1-\xEC\xEE][\x80-\xBF]{2}' + // 3-byte, but exclude U-FFFE and U-FFFF
					  '|\xEF[\x80-\xBE][\x80-\xBF]' +
					  '|\xEF\xBF[\x80-\xBD]' +
					  '|\xED[\x80-\x9F][\x80-\xBF]' +    // excluding surrogates
					  '|\xF0[\x90-\xBF][\x80-\xBF]{2}' + // planes 1-3
					  '|[\xF1-\xF3][\x80-\xBF]{3}' +     // planes 4-15
					  '|\xF4[\x80-\x8F][\x80-\xBF]{2}' + // plane 16
					')*$');
				
				// Read all currently available bytes from file. I'm not sure how many this is
				// but it's a safe bet that we don't want to try to read any more than this, since
				// it would slow things down considerably.
				if(Zotero.isFx4) {
					var fileContents = NetUtil.readInputStreamToString(this._rawStream, this._rawStream.available());
				} else {
					var fileContents = binStream.readByteArray(this._rawStream.available());
					fileContents = String.fromCharCode.apply(null, fileContents);
				}
				
				// Seek back to beginning of file
				this._seekToStart();
				
				// See whether this could be UTF-8
				if(UTF8Regex.test(fileContents)) {
					// Assume this is UTF-8
					this._charset = "UTF-8";
				} else {
					// Can't be UTF-8; see if a default charset is defined
					this._charset = Zotero.Prefs.get("intl.charset.default", true);
					
					// ISO-8859-1 by default
					if(!this._charset) this._charset = "ISO-8859-1";
				}
			} else {
				// No need to auto-detect; user has specified a charset
				this._charset = charsetPref;
			}
		}
	}
	
	Zotero.debug("Translate: Detected file charset as "+this._charset);
		
	// We know the charset now. Open a converter stream.
	if(mode) this.reset(mode);
}

Zotero.Translate.IO.Read.prototype = {
	"__exposedProps__":["_getXML", "RDF", "read", "setCharacterSet"],
	
	"_seekToStart":function() {
		this._rawStream.QueryInterface(Components.interfaces.nsISeekableStream)
			.seek(Components.interfaces.nsISeekableStream.NS_SEEK_SET, this._bomLength);
	},
	
	"_readToString":function() {
		var str = {};
		this.inputStream.readString(this.file.fileSize, str);
		return str.value;
	},
	
	"_initRDF":function() {
		// get URI
		var IOService = Components.classes['@mozilla.org/network/io-service;1']
						.getService(Components.interfaces.nsIIOService);
		var fileHandler = IOService.getProtocolHandler("file")
						  .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
		var baseURI = fileHandler.getURLSpecFromFile(this.file);
		
		Zotero.debug("Translate: Initializing RDF data store");
		this._dataStore = new Zotero.RDF.AJAW.RDFIndexedFormula();
		var parser = new Zotero.RDF.AJAW.RDFParser(this._dataStore);
		var nodes = Zotero.Translate.IO.parseDOMXML(this._rawStream, this._charset, this.file.fileSize);
		parser.parse(nodes, baseURI);
		
		this.RDF = new Zotero.Translate.IO._RDFSandbox(this._dataStore);
	},
	
	"setCharacterSet":function(charset) {
		if(typeof charset !== "string") {
			throw "Translate: setCharacterSet: charset must be a string";
		}
		
		// seek back to the beginning
		this._seekToStart();
		
		if(this._allowCharsetOverride) {	
			this.inputStream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
								   .createInstance(Components.interfaces.nsIConverterInputStream);
			try {
				this.inputStream.init(this._rawStream, charset, 65535,
					Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
			} catch(e) {
				throw "Translate: setCharacterSet: text encoding not supported";
			}
		} else {
			Zotero.debug("Translate: setCharacterSet: translate charset override ignored due to BOM or XML parse instruction");
		}
	},
	
	"read":function(bytes) {
		var str = {};
		
		if(bytes) {
			// read number of bytes requested
			var amountRead = this.inputStream.readString(bytes, str);
		} else {
			// bytes not specified; read a line
			this.inputStream.QueryInterface(Components.interfaces.nsIUnicharLineInputStream);
			var amountRead = this.inputStream.readLine(str);
		}
					
		if(amountRead) {
			return str.value;
		} else {
			return false;
		}
	},
	
	"_getXML":function() {
		if(this._mode == "xml/dom") {
			return Zotero.Translate.IO.parseDOMXML(this._rawStream, this._charset, this.file.fileSize);
		} else {
			return this._readToString().replace(/<\?xml[^>]+\?>/, "");
		}
	},
	
	"reset":function(newMode) {
		this._seekToStart();
		this.inputStream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
			.createInstance(Components.interfaces.nsIConverterInputStream);
		this.inputStream.init(this._rawStream, this._charset, 65535,
			Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
		
		this._mode = newMode;
		if(Zotero.Translate.IO.rdfDataModes.indexOf(this._mode) !== -1 && !this.RDF) {
			this._initRDF();
		}
	},
	
	"close":function() {
		this.inputStream.close();
	}
}

/******* Write support *******/

Zotero.Translate.IO.Write = function(file, mode, charset) {
	this._rawStream = Components.classes["@mozilla.org/network/file-output-stream;1"]
		.createInstance(Components.interfaces.nsIFileOutputStream);
	this._rawStream.init(file, 0x02 | 0x08 | 0x20, 0664, 0); // write, create, truncate
	this._writtenToStream = false;
	if(mode) this.reset(mode, charset);
}

Zotero.Translate.IO.Write.prototype = {
	"__exposedProps__":["RDF", "write", "setCharacterSet"],
	
	"_initRDF":function() {
		Zotero.debug("Translate: Initializing RDF data store");
		this._dataStore = new Zotero.RDF.AJAW.RDFIndexedFormula();
		this.RDF = new Zotero.Translate.IO._RDFSandbox(this._dataStore);
	},
	
	"setCharacterSet":function(charset) {
		if(typeof charset !== "string") {
			throw "Translate: setCharacterSet: charset must be a string";
		}
		
		this.outputStream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
							   .createInstance(Components.interfaces.nsIConverterOutputStream);
		if(charset == "UTF-8xBOM") charset = "UTF-8";
		this.outputStream.init(this._rawStream, charset, 1024, "?".charCodeAt(0));
		this._charset = charset;
	},
	
	"write":function(data) {
		if(!this._writtenToStream && this._charset.substr(this._charset.length-4) == "xBOM"
		   && BOMs[this._charset.substr(0, this._charset.length-4).toUpperCase()]) {
			// If stream has not yet been written to, and a UTF type has been selected, write BOM
			this._rawStream.write(BOMs[streamCharset], BOMs[streamCharset].length);
		}
		
		if(this._charset == "MACINTOSH") {
			// fix buggy Mozilla MacRoman
			var splitData = data.split(/([\r\n]+)/);
			for(var i=0; i<splitData.length; i+=2) {
				// write raw newlines straight to the string
				this.outputStream.writeString(splitData[i]);
				if(splitData[i+1]) {
					this._rawStream.write(splitData[i+1], splitData[i+1].length);
				}
			}
		} else {
			this.outputStream.writeString(data);
		}
		
		this._writtenToStream = true;
	},
	
	"reset":function(newMode, charset) {
		this._mode = newMode;
		if(Zotero.Translate.IO.rdfDataModes.indexOf(this._mode) !== -1) {
			this._initRDF();
			if(!this._writtenToString) this.setCharacterSet("UTF-8");
		} else if(!this._writtenToString) {
			this.setCharacterSet(charset ? charset : "UTF-8");
		}
	},
	
	"close":function() {
		if(Zotero.Translate.IO.rdfDataModes.indexOf(this._mode) !== -1) {
			this.write(this.RDF.serialize());
		} else {
			this.outputStream.close();
		}
	}
}