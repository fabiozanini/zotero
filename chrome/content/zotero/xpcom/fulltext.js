/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

Zotero.Fulltext = new function(){
	const FULLTEXT_VERSION = 1;
	const CACHE_FILE = '.zotero-ft-cache';
	
	this.init = init;
	this.registerPDFTool = registerPDFTool;
	this.pdfConverterIsRegistered = pdfConverterIsRegistered;
	this.pdfInfoIsRegistered = pdfInfoIsRegistered;
	this.isCachedMIMEType = isCachedMIMEType;
	this.indexWords = indexWords;
	this.indexDocument = indexDocument;
	this.indexString = indexString;
	this.indexFile = indexFile;
	this.indexPDF = indexPDF;
	this.indexItems = indexItems;
	this.findTextInFile = findTextInFile;
	this.findTextInItems = findTextInItems;
	this.clearItemWords = clearItemWords;
	this.getPages = getPages;
	this.getTotalPagesFromFile = getTotalPagesFromFile;
	this.getChars = getChars;
	this.getTotalCharsFromFile = getTotalCharsFromFile;
	this.setChars = setChars;
	this.setPages = setPages;
	this.getIndexedState = getIndexedState;
	this.getIndexStats = getIndexStats;
	this.canReindex = canReindex;
	this.rebuildIndex = rebuildIndex;
	this.clearIndex = clearIndex;
	this.clearCacheFile = clearCacheFile;
	this.clearCacheFiles = clearCacheFiles;
	//this.clearItemContent = clearItemContent;
	this.purgeUnusedWords = purgeUnusedWords;
	this.HTMLToText = HTMLToText;
	this.semanticSplitter = semanticSplitter;
	
	this.__defineGetter__("pdfToolsDownloadBaseURL", function() { return 'http://www.zotero.org/download/xpdf/'; });
	this.__defineGetter__("pdfToolsName", function() { return 'Xpdf'; });
	this.__defineGetter__("pdfToolsURL", function() { return 'http://www.foolabs.com/xpdf/'; });
	this.__defineGetter__("pdfConverterName", function() { return 'pdftotext'; });
	this.__defineGetter__("pdfInfoName", function() { return 'pdfinfo'; });
	this.__defineGetter__("pdfConverterCacheFile", function () { return '.zotero-ft-cache'; });
	this.__defineGetter__("pdfInfoCacheFile", function () { return '.zotero-ft-info'; });
	
	this.__defineGetter__("INDEX_STATE_UNAVAILABLE", function () { return 0; });
	this.__defineGetter__("INDEX_STATE_UNINDEXED", function () { return 1; });
	this.__defineGetter__("INDEX_STATE_PARTIAL", function () { return 2; });
	this.__defineGetter__("INDEX_STATE_INDEXED", function () { return 3; });
	
	
	var _pdfConverterVersion = null;
	var _pdfConverterFileName = null;
	var _pdfConverter = null; // nsIFile to executable
	var _pdfInfoVersion = null;
	var _pdfInfoFileName = null;
	var _pdfInfo = null; // nsIFile to executable
	
	var self = this;
	
	function init() {
		var platform = Zotero.platform.replace(' ', '-');
		_pdfConverterFileName = this.pdfConverterName + '-' + platform;
		_pdfInfoFileName = this.pdfInfoName + '-' + platform;
		if (Zotero.isWin) {
			_pdfConverterFileName += '.exe';
			_pdfInfoFileName += '.exe';
		}
		
		this.__defineGetter__("pdfConverterFileName", function() { return _pdfConverterFileName; });
		this.__defineGetter__("pdfConverterVersion", function() { return _pdfConverterVersion; });
		this.__defineGetter__("pdfInfoFileName", function() { return _pdfInfoFileName; });
		this.__defineGetter__("pdfInfoVersion", function() { return _pdfInfoVersion; });
		
		this.registerPDFTool('converter');
		this.registerPDFTool('info');
	}
	
	
	/*
	 * Looks for pdftotext-{platform}[.exe] in the Zotero data directory
	 *
	 * {platform} is navigator.platform, with spaces replaced by hyphens
	 *   e.g. "Win32", "Linux-i686", "MacPPC", "MacIntel", etc.
	 */
	function registerPDFTool(tool) {
		var errMsg = false;
		var exec = Zotero.getZoteroDirectory();
		
		switch (tool) {
			case 'converter':
				var toolName = this.pdfConverterName;
				var fileName = _pdfConverterFileName
				break;
				
			case 'info':
				var toolName = this.pdfInfoName;
				var fileName = _pdfInfoFileName
				break;
			
			default:
				throw ("Invalid PDF tool type '" + tool + "' in Zotero.Fulltext.registerPDFTool()");
		}
		
		exec.append(fileName);
		if (!exec.exists()) {
			exec = null;
			errMsg = fileName + ' not found';
		}
		
		if (!exec) {
			if (tool == 'converter') {
				Zotero.debug(errMsg + ' -- PDF indexing disabled');
			}
			return false;
		}
		
		var versionFile = exec.parent;
		versionFile.append(fileName + '.version');
		if (versionFile.exists()) {
			var version = Zotero.File.getSample(versionFile).split(/[\r\n\s]/)[0];
		}
		if (!version) {
			var version = 'UNKNOWN';
		}
		
		switch (tool) {
			case 'converter':
				_pdfConverter = exec;
				_pdfConverterVersion = version;
				break;
				
			case 'info':
				_pdfInfo = exec;
				_pdfInfoVersion = version;
				break;
		}
		
		Zotero.debug(toolName + ' version ' + version + ' registered at ' + exec.path);
		
		return true;
	}
	
	
	function pdfConverterIsRegistered() {
		return !!_pdfConverter;
	}
	
	
	function pdfInfoIsRegistered() {
		return !!_pdfInfo;
	}
	
	
	/*
	 * Returns true if MIME type is converted to text and cached before indexing
	 *   (e.g. application/pdf is run through pdftotext)
	 */
	function isCachedMIMEType(mimeType) {
		switch (mimeType) {
			case 'application/pdf':
				return true;
		}
		return false;
	}
	
	
	/*
	 * Index multiple words at once
	 */
	function indexWords(itemID, words){
		if (!words || !words.length || !itemID){
			return false;
		}
		
		var existing = [];
		var done = 0;
		var maxWords = 999; // compiled limit
		var numWords = words.length;
		
		Zotero.DB.beginTransaction();
		
		var origWords = [];
		
		do {
			var chunk = words.splice(0, maxWords);
			origWords = origWords.concat(chunk);
			
			var sqlQues = [];
			var sqlParams = [];
			
			for each(var word in chunk) {
				sqlQues.push('?');
				sqlParams.push( { string: word } );
			}
			
			var sql = "SELECT word, wordID from fulltextWords WHERE word IN ("
			sql += sqlQues.join() + ")";
			var wordIDs = Zotero.DB.query(sql, sqlParams);
			
			for (var i in wordIDs) {
				// Underscore avoids problems with JS reserved words
				existing['_' + wordIDs[i].word] = wordIDs[i].wordID;
			}
			
			done += chunk.length;
		}
		while (done < numWords);
		
		Zotero.DB.query("REPLACE INTO fulltextItems (itemID, version) VALUES (?,?)",
			[itemID, FULLTEXT_VERSION]);
		
		
		// Handle bound parameters manually for optimal speed
		var statement1 = Zotero.DB.getStatement("INSERT INTO fulltextWords (word) VALUES (?)");
		var statement2 = Zotero.DB.getStatement("INSERT OR IGNORE INTO fulltextItemWords VALUES (?,?)");
		
		for each(var word in origWords) {
			// Skip words containing invalid characters
			if (word.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/)) {
				Zotero.debug("Skipping word '" + word + "' due to invalid characters");
				continue;
			}
			if (existing['_' + word]){
				var wordID = existing['_' + word];
			}
			else {
				statement1.bindUTF8StringParameter(0, word);
				statement1.execute()
				var wordID = Zotero.DB.getLastInsertID();
			}
			
			statement2.bindInt32Parameter(0, wordID);
			statement2.bindInt32Parameter(1, itemID);
			statement2.execute();
		}
		
		statement1.reset();
		statement2.reset();
		
		Zotero.DB.commitTransaction();
	}
	
	
	function indexString(text, charset, itemID){
		try {
			Zotero.UnresponsiveScriptIndicator.disable();
			
			var words = semanticSplitter(text, charset);
			
			Zotero.DB.beginTransaction();
			
			this.clearItemWords(itemID, true);
			this.indexWords(itemID, words);
			
			/*
			var sql = "REPLACE INTO fulltextContent (itemID, textContent) VALUES (?,?)";
			Zotero.DB.query(sql, [itemID, {string:text}]);
			*/
			
			Zotero.DB.commitTransaction();
		}
		finally {
			Zotero.UnresponsiveScriptIndicator.enable();
		}
	}
	
	
	function indexDocument(document, itemID){
		if (!itemID){
			throw ('Item ID not provided to indexDocument()');
		}
		
		Zotero.debug("Indexing document '" + document.title + "'");
		
		if (!document.body) {
			Zotero.debug("Cannot index " + document.contentType + " file in indexDocument()", 2);
			return false;
		}
		
		if (!document.characterSet){
			Zotero.debug("Text file didn't have charset in indexFile()", 1);
			return false;
		}
		
		var text = document.body.innerHTML;
		
		var maxLength = Zotero.Prefs.get('fulltext.textMaxLength');
		if (text.length > maxLength) {
			Zotero.debug('Only indexing first ' + maxLength + ' characters of item '
				+ itemID + ' in indexDocument()');
			text = text.substr(0, maxLength);
		}
		
		text = text.replace(/(>)/g, '$1 ');
		text = this.HTMLToText(text);
		this.indexString(text, document.characterSet, itemID);
		
		var charsIndexed = Math.min(maxLength, text.length);
		this.setChars(itemID, { indexed: charsIndexed, total: text.length });
	}
	
	
	function indexFile(file, mimeType, charset, itemID, maxLength, isCacheFile) {
		if (!file.exists()){
			Zotero.debug('File not found in indexFile()', 2);
			return false;
		}
		
		if (!itemID){ throw ('Item ID not provided to indexFile()'); }
		
		if (!mimeType) {
			Zotero.debug("MIME type not provided in indexFile()", 1);
			return false;
		}
		
		if (maxLength == undefined || maxLength === true) {
			maxLength = Zotero.Prefs.get('fulltext.textMaxLength');
		}
		// If maxLength is explicitly false, index everything
		else if (maxLength === false || maxLength === null) {
			maxLength = false;
		}
		
		if (mimeType == 'application/pdf') {
			try {
				Zotero.UnresponsiveScriptIndicator.disable();
				return this.indexPDF(file, itemID, !maxLength);
			}
			finally {
				Zotero.UnresponsiveScriptIndicator.enable();
			}
		}
		
		if (mimeType.substr(0, 5)!='text/'){
			Zotero.debug('File is not text in indexFile()', 2);
			return false;
		}
		
		if (!charset){
			Zotero.debug("Text file didn't have charset in indexFile()", 1);
			return false;
		}
		
		Zotero.debug('Indexing file ' + file.path);
		
		var text = Zotero.File.getContents(file, charset, maxLength);
		// Split elements to avoid word concatentation
		text = text.replace(/(>)/g, '$1 ');
		text = this.HTMLToText(text);
		this.indexString(text, charset, itemID);
		
		// Record number of characters indexed
		if (!isCacheFile) {
			try {
				var totalChars = this.getTotalCharsFromFile(itemID);
			}
			catch (e) {
				Zotero.debug(e);
				Components.utils.reportError(e);
				totalChars = 0;
			}
			if (maxLength) {
				var charsIndexed = Math.min(maxLength, totalChars);
			}
			else {
				var charsIndexed = totalChars;
			}
			this.setChars(itemID, { indexed: charsIndexed, total: totalChars });
		}
		
		return true;
	}
	
	
	/*
	 * Run PDF through pdfinfo and pdftotext to generate .zotero-ft-info
	 * and .zotero-ft-cache, and pass the text file back to indexFile()
	 *
	 * @param	 allPages	 If true, index all pages rather than pdfMaxPages
	 */
	function indexPDF(file, itemID, allPages) {
		if (!_pdfConverter) {
			return false;
		}
		
		var maxPages = Zotero.Prefs.get('fulltext.pdfMaxPages');
		if (maxPages == 0) {
			return false;
		}
		
		var item = Zotero.Items.get(itemID);
		var linkMode = item.attachmentLinkMode;
		// If file is stored outside of Zotero, create a directory for the item
		// in the storage directory and save the cache file there
		if (linkMode == Zotero.Attachments.LINK_MODE_LINKED_FILE) {
			var cacheFile = Zotero.Attachments.createDirectoryForItem(itemID);
		}
		else {
			var cacheFile = file.parent;
		}
		cacheFile.append(this.pdfConverterCacheFile);
		
		if (_pdfInfo) {
			var infoFile = cacheFile.parent;
			infoFile.append(this.pdfInfoCacheFile);
			Zotero.debug('Running pdfinfo "' + file.path + '" "' + infoFile.path + '"');
			
			var proc = Components.classes["@mozilla.org/process/util;1"].
					createInstance(Components.interfaces.nsIProcess);
			proc.init(_pdfInfo);
			
			var args = [file.path, infoFile.path];
			try {
				proc.runw(true, args, args.length);
				var totalPages = this.getTotalPagesFromFile(itemID);
			}
			catch (e) {
				Zotero.debug("Error running pdfinfo");
			}
		}
		else {
			Zotero.debug(this.pdfInfoName + " is not available");
		}
		
		Zotero.debug('Running pdftotext -enc UTF-8 -nopgbrk '
			+ (allPages ? '' : '-l ' + maxPages) + ' "' + file.path + '" "'
			+ cacheFile.path + '"');
		
		var proc = Components.classes["@mozilla.org/process/util;1"].
				createInstance(Components.interfaces.nsIProcess);
		proc.init(_pdfConverter);
		
		var args = ['-enc', 'UTF-8', '-nopgbrk'];
		if (allPages) {
			if (totalPages) {
				var pagesIndexed = totalPages;
			}
		}
		else {
			args.push('-l', maxPages);
			var pagesIndexed = Math.min(maxPages, totalPages);
		}
		args.push(file.path, cacheFile.path);
		try {
			proc.runw(true, args, args.length);
		}
		catch (e) {
			Zotero.debug("Error running pdftotext");
			return false;
		}
		
		if (!cacheFile.exists()) {
			var msg = file.leafName + " was not indexed";
			if (!file.leafName.match(/^[\u0000-\u007F]+$/)) {
				msg += " -- PDFs with filenames containing extended characters cannot currently be indexed due to a Firefox limitation";
			}
			Zotero.debug(msg, 2);
			Components.utils.reportError(msg);
			return false;
		}
		
		Zotero.DB.beginTransaction();
		this.indexFile(cacheFile, 'text/plain', 'utf-8', itemID, false, true);
		this.setPages(itemID, { indexed: pagesIndexed, total: totalPages });
		Zotero.DB.commitTransaction();
		return true;
	}
	
	
	function indexItems(items, complete, ignoreErrors) {
		if (items.constructor.name != 'Array') {
			items = [items];
		}
		var items = Zotero.Items.get(items);
		var found = [];
		
		Zotero.DB.beginTransaction();
		
		for each(var i in items){
			if (!i.isAttachment()){
				continue;
			}
			
			var file = i.getFile();
			if (!file){
				Zotero.debug("No file to index for item " + i.id + " in Fulltext.indexItems()");
				continue;
			}
			
			if (ignoreErrors) {
				try {
					this.indexFile(file, i.attachmentMIMEType, i.attachmentCharset, i.id, !complete);
				}
				catch (e) {
					Zotero.debug(e, 1);
					Components.utils.reportError("Error indexing " + file.path);
					Components.utils.reportError(e);
				}
			}
			else {
				this.indexFile(file, i.attachmentMIMEType, i.attachmentCharset, i.id, !complete);
			}
		}
		
		Zotero.DB.commitTransaction();
	}
	
	
	/*
	 * Scan a file for a text string
	 *
	 * _items_ -- one or more attachment items to search
	 * _searchText_ -- text pattern to search for
	 * _mode_:
	 *    'regexp' -- regular expression (case-insensitive)
	 *    'regexpCS' -- regular expression (case-sensitive)
	 *
	 * - Slashes in regex are optional
	 */
	function findTextInFile(file, charset, searchText, mode){
		Zotero.debug("Searching for text '" + searchText + "' in " + file.path);
		
		var maxLength = Zotero.Prefs.get('fulltext.textMaxLength');
		var str = Zotero.File.getContents(file, charset, maxLength);
		
		// If not binary mode, convert HTML to text
		if (!mode || mode.indexOf('Binary')==-1){
			// Split elements to avoid word concatentation
			str = str.replace(/(>)/g, '$1 ');
			
			// Parse to avoid searching on HTML
			str = this.HTMLToText(str);
		}
		
		switch (mode){
			case 'regexp':
			case 'regexpCS':
			case 'regexpBinary':
			case 'regexpCSBinary':
				// Do a multiline search by default
				var flags = 'm';
				var parts = searchText.match(/^\/(.*)\/([^\/]*)/);
				if (parts){
					searchText = parts[1];
					// Ignore user-supplied flags
					//flags = parts[2];
				}
				
				if (mode.indexOf('regexpCS')==-1){
					flags += 'i';
				}
				
				var re = new RegExp(searchText, flags);
				var matches = re(str);
				if (matches){
					Zotero.debug("Text found");
					return str.substr(matches.index, 50);
				}
				
				break;
			
			default:
				// Case-insensitive
				searchText = searchText.toLowerCase();
				str = str.toLowerCase();
				
				var pos = str.indexOf(searchText);
				if (pos!=-1){
					Zotero.debug('Text found');
					return str.substr(pos, 50);
				}
		}
		
		return -1;
	}
	
	/*
	 * Scan item files for a text string
	 *
	 * _items_ -- one or more attachment items to search
	 * _searchText_ -- text pattern to search for
	 * _mode_:
	 *    'phrase'
	 *    'regexp'
	 *    'regexpCS' -- case-sensitive regular expression
	 *
	 * Note:
	 *  - Slashes in regex are optional
	 *  - Add 'Binary' to the mode to search all files, not just text files
	 */
	function findTextInItems(items, searchText, mode){
		if (!searchText){
			return [];
		}
		
		var items = Zotero.Items.get(items);
		var found = [];
		
		for each(var i in items){
			if (!i.isAttachment()){
				continue;
			}
			
			var file = i.getFile();
			if (!file){
				continue;
			}
			
			var mimeType = i.attachmentMIMEType;
			if (isCachedMIMEType(mimeType)) {
				var file = this.getItemCacheFile(i.id);
				if (!file.exists()) {
					continue;
				}
				
				mimeType = 'text/plain';
				var charset = 'utf-8';
			}
			else {
				// If not binary mode, only scan plaintext files
				if (!mode || mode.indexOf('Binary') == -1) {
					if (!Zotero.MIME.isTextType(mimeType)) {
						Zotero.debug('Not scanning MIME type ' + mimeType, 4);
						continue;
					}
				}
				
				var charset = i.attachmentCharset;
			}
			
			var match = this.findTextInFile(file, charset, searchText, mode);
			
			if (match != -1){
				found.push({id:i.getID(), match:match});
			}
		}
		
		return found;
	}
	
	
	function clearItemWords(itemID, skipCacheClear) {
		Zotero.DB.beginTransaction();
		var sql = "SELECT rowid FROM fulltextItems WHERE itemID=? LIMIT 1";
		var indexed = Zotero.DB.valueQuery(sql, itemID);
		if (indexed) {
			Zotero.DB.query("DELETE FROM fulltextItems WHERE itemID=?", itemID);
			Zotero.DB.query("DELETE FROM fulltextItemWords WHERE itemID=?", itemID);
		}
		Zotero.DB.commitTransaction();
		
		if (indexed) {
			Zotero.Prefs.set('purge.fulltext', true);
		}
		
		if (!skipCacheClear) {
			// Delete fulltext cache file if there is one
			this.clearCacheFile(itemID);
		}
	}
	
	
	function getPages(itemID, force) {
		var sql = "SELECT indexedPages, totalPages AS total "
			+ "FROM fulltextItems WHERE itemID=?";
		return Zotero.DB.rowQuery(sql, itemID);
	}
	
	
	/*
	 * Gets the number of pages from the PDF info cache file
	 */
	function getTotalPagesFromFile(itemID) {
		var file = Zotero.Attachments.getStorageDirectory(itemID);
		file.append(this.pdfInfoCacheFile);
		if (!file.exists()) {
			return false;
		}
		var contents = Zotero.File.getContents(file);
		try {
			// Parse pdfinfo output
			var pages = contents.match('Pages:[^0-9]+([0-9]+)')[1];
		}
		catch (e) {
			Zotero.debug(e);
			return false;
		}
		return pages;
	}
	
	
	function getChars(itemID) {
		var sql = "SELECT indexedChars, totalChars AS total "
			+ "FROM fulltextItems WHERE itemID=?";
		return Zotero.DB.rowQuery(sql, itemID);
	}
	
	
	/*
	 * Gets the number of characters from the PDF converter cache file
	 */
	function getTotalCharsFromFile(itemID) {
		var item = Zotero.Items.get(itemID);
		switch (item.attachmentMIMEType) {
			case 'application/pdf':
				var file = Zotero.Attachments.getStorageDirectory(itemID);
				file.append(this.pdfConverterCacheFile);
				if (!file.exists()) {
					return false;
				}
				break;
				
			default:
				var file = item.getFile();
				if (!file) {
					return false;
				}
		}
		
		return Zotero.File.getContents(file).length;
	}
	
	
	function setPages(itemID, obj) {
		var sql = "UPDATE fulltextItems SET indexedPages=?, totalPages=? WHERE itemID=?";
		Zotero.DB.query(sql, [obj.indexed ? obj.indexed : null,
			obj.total ? obj.total : null, itemID]);
	}
	
	
	function setChars(itemID, obj) {
		var sql = "UPDATE fulltextItems SET indexedChars=?, totalChars=? WHERE itemID=?";
		Zotero.DB.query(sql, [obj.indexed ? obj.indexed : null,
			obj.total ? obj.total : null, itemID]);
	}
	
	
	/*
	 * Gets the indexed state of an item, 
	 */
	function getIndexedState(itemID) {
		var item = Zotero.Items.get(itemID);
		if (!item) {
			throw ("Invalid item " + itemID + " in Zotero.Fulltext.getIndexedState()");
		}
		
		if (!item.isAttachment()) {
			throw ('Item ' + itemID + ' is not an attachment in Zotero.Fulltext.getIndexedState()');
		}
		
		switch (item.attachmentMIMEType) {
			// Use pages for PDFs
			case 'application/pdf':
				var pages = this.getPages(itemID);
				if (pages) {
					var indexedPages = pages.indexedPages;
					var totalPages = pages.total;
					
					if (!totalPages && !indexedPages) {
						var status = this.INDEX_STATE_UNAVAILABLE;
					}
					else if (!indexedPages) {
						var status = this.INDEX_STATE_UNINDEXED;
					}
					else if (indexedPages < totalPages) {
						var status = this.INDEX_STATE_PARTIAL;
					}
					else {
						var status = this.INDEX_STATE_INDEXED;
					}
				}
				else {
					var status = this.INDEX_STATE_UNINDEXED;
				}
				break;
			
			// Use chars
			default:
				var chars = this.getChars(itemID);
				if (chars) {
					var indexedChars = chars.indexedChars;
					var totalChars = chars.total;
					
					if (!totalChars && !indexedChars) {
						var status = this.INDEX_STATE_UNAVAILABLE;
					}
					else if (!indexedChars) {
						var status = this.INDEX_STATE_UNINDEXED;
					}
					else if (indexedChars < totalChars) {
						var status = this.INDEX_STATE_PARTIAL;
					}
					else {
						var status = this.INDEX_STATE_INDEXED;
					}
				}
				else {
					var status = this.INDEX_STATE_UNINDEXED;
				}
		}
		return status;
	}
	
	
	this.isFullyIndexed = function (itemID) {
		if (!itemID) {
			throw ("itemID not provided in Zotero.Fulltext.isFullyIndexed()");
		}
		return this.getIndexedState(itemID) == this.INDEX_STATE_INDEXED;
	}
	
	
	function getIndexStats() {
		var sql = "SELECT COUNT(*) FROM fulltextItems WHERE "
			+ "(indexedPages IS NOT NULL AND indexedPages=totalPages) OR "
			+ "(indexedChars IS NOT NULL AND indexedChars=totalChars)"
		var indexed = Zotero.DB.valueQuery(sql);
		
		var sql = "SELECT COUNT(*) FROM fulltextItems WHERE "
			+ "(indexedPages IS NOT NULL AND indexedPages<totalPages) OR "
			+ "(indexedChars IS NOT NULL AND indexedChars<totalChars)"
		var partial = Zotero.DB.valueQuery(sql);
		
		var sql = "SELECT COUNT(*) FROM itemAttachments WHERE itemID NOT IN "
			+ "(SELECT itemID FROM fulltextItems WHERE "
			+ "indexedPages IS NOT NULL OR indexedChars IS NOT NULL)";
		var unindexed = Zotero.DB.valueQuery(sql);
		
		var sql = "SELECT COUNT(*) FROM fulltextWords";
		var words = Zotero.DB.valueQuery(sql);
		
		return { indexed: indexed, partial: partial, unindexed: unindexed,
			words: words };
	}
	
	
	this.getItemCacheFile = function (itemID) {
		var cacheFile = Zotero.Attachments.getStorageDirectory(itemID);
		cacheFile.append(self.pdfConverterCacheFile);
		return cacheFile;
	}
	
	
	/*
	 * Returns true if an item can be reindexed
	 *
	 * Item must be a non-web-link attachment that isn't already fully indexed
	 */
	function canReindex(itemID) {
		var item = Zotero.Items.get(itemID);
		if (item && item.isAttachment() && item.attachmentLinkMode !=
				Zotero.Attachments.LINK_MODE_LINKED_URL) {
			switch (this.getIndexedState(itemID)) {
				case this.INDEX_STATE_UNAVAILABLE:
				case this.INDEX_STATE_UNINDEXED:
				case this.INDEX_STATE_PARTIAL:
				
				// TODO: automatically reindex already-indexed attachments?
				case this.INDEX_STATE_INDEXED:
					return true;
			}
		}
		
		return false;
	}
	
	
	function rebuildIndex(unindexedOnly){
		Zotero.DB.beginTransaction();
		
		// Get all attachments other than web links
		var sql = "SELECT itemID FROM itemAttachments WHERE linkMode!="
			+ Zotero.Attachments.LINK_MODE_LINKED_URL;
		if (unindexedOnly) {
			sql += " AND itemID NOT IN (SELECT itemID FROM fulltextItems "
				+ "WHERE indexedChars IS NOT NULL OR indexedPages IS NOT NULL)";
		}
		var items = Zotero.DB.columnQuery(sql);
		if (items) {
			Zotero.DB.query("DELETE FROM fulltextItemWords WHERE itemID IN (" + sql + ")");
			Zotero.DB.query("DELETE FROM fulltextItems WHERE itemID IN (" + sql + ")");
			this.indexItems(items, false, true);
		}
		Zotero.DB.commitTransaction();
	}
	
	
	/*
	 * Clears full-text word index and all full-text cache files
	 */
	function clearIndex(skipLinkedURLs) {
		Zotero.DB.beginTransaction();
		
		var sql = "DELETE FROM fulltextItems";
		if (skipLinkedURLs) {
			var linkSQL = "SELECT itemID FROM itemAttachments WHERE linkMode ="
				+ Zotero.Attachments.LINK_MODE_LINKED_URL;
			
			sql += " WHERE itemID NOT IN (" + linkSQL + ")";
		}
		Zotero.DB.query(sql);
		
		sql = "DELETE FROM fulltextItemWords";
		if (skipLinkedURLs) {
			sql += " WHERE itemID NOT IN (" + linkSQL + ")";
		}
		Zotero.DB.query(sql);
		
		if (skipLinkedURLs) {
			this.purgeUnusedWords();
		}
		else {
			Zotero.DB.query("DELETE FROM fulltextWords");
		}
		
		this.clearCacheFiles();
		
		Zotero.DB.commitTransaction();
	}
	
	
	/*
	 * Clears cache file for an item
	 */
	function clearCacheFile(itemID) {
		var item = Zotero.Items.get(itemID);
		if (!item) {
			return;
		}
		
		if (!item.isAttachment()) {
			Zotero.debug("Item " + itemID + " is not an attachment in Zotero.Fulltext.clearCacheFile()");
			return;
		}
		
		Zotero.debug('Clearing full-text cache file for item ' + itemID);
		switch (item.attachmentMIMEType) {
			case 'application/pdf':
				var cacheFile = this.getItemCacheFile(itemID);
				if (cacheFile.exists()) {
					try {
						cacheFile.remove(false);
					}
					catch (e) {
						Zotero.File.checkFileAccessError(e, cacheFile, 'delete');
					}
				}
				break;
		}
	}
	
	
	/*
	 * Clear cache files for all attachments
	 */
	function clearCacheFiles(skipLinkedURLs) {
		var sql = "SELECT itemID FROM itemAttachments";
		if (skipLinkedURLs) {
			sql += " WHERE linkMode != " + Zotero.Attachments.LINK_MODE_LINKED_URL;
		}
		var items = Zotero.DB.columnQuery(sql);
		for (var i=0; i<items.length; i++) {
			this.clearCacheFile(items[i]);
		}
	}
	
	
	/*
	function clearItemContent(itemID){
		Zotero.DB.query("DELETE FROM fulltextContent WHERE itemID=" + itemID);
	}
	*/
	
	
	function purgeUnusedWords() {
		if (!Zotero.Prefs.get('purge.fulltext')) {
			return;
		}
		
		var sql = "DELETE FROM fulltextWords WHERE wordID NOT IN "
					+ "(SELECT wordID FROM fulltextItemWords)";
		Zotero.DB.query(sql);
		
		Zotero.Prefs.set('purge.fulltext', false)
	}
	
	
	function HTMLToText(text){
		var	nsIFC =
			Components.classes['@mozilla.org/widget/htmlformatconverter;1'].
				createInstance(Components.interfaces.nsIFormatConverter);
		var from = Components.classes['@mozilla.org/supports-string;1'].
			createInstance(Components.interfaces.nsISupportsString);
		from.data = text;
		var to = {value:null};
		try {
			nsIFC.convert('text/html', from, from.toString().length,
				'text/unicode', to, {});
			to = to.value.QueryInterface(Components.interfaces.nsISupportsString);
			return to.toString();
		}
		catch(e){
			Zotero.debug(e, 1);
			return text;
		}
	}
	
	
	function semanticSplitter(text, charset){
		if (!text){
			Zotero.debug('No text to index');
			return;
		}
		
		text = _markTroubleChars(text);
		
		var serv = Components.classes["@mozilla.org/intl/semanticunitscanner;1"]
				.createInstance(Components.interfaces.nsISemanticUnitScanner);
		
		var words = [], unique = {}, begin = {}, end = {}, nextPos = 0;
		serv.start(charset ? charset : null);
		do {
			var next = serv.next(text, text.length, nextPos, true, begin, end);
			var str = text.substring(begin.value, end.value);
			
			// Skip non-breaking spaces
			if (!str || str.charCodeAt(0)==32 || str.charCodeAt(0)==160){
				nextPos = end.value;
				begin = {}, end = {};
				continue;
			}
			
			// Create alphanum hash keys out of the character codes
			var lc = str.toLowerCase();
			
			// And store the unique ones
			if (!unique[lc]){
				unique[lc] = true;
			}
			
			nextPos = end.value;
			begin = {}, end = {};
		}
		while (next);
		
		for (var i in unique){
			words.push(_restoreTroubleChars(i));
		}
		
		return words;
	}
	
	
	/*
	 * Add spaces between elements, since HTMLToText doesn't
	 *
	 * NOTE: SLOW AND NOT USED!
	 */
	function _separateElements(node){
		var next = node;
		do {
			if (next.hasChildNodes()){
				_separateElements(next.firstChild);
			}
			
			var space = node.ownerDocument.createTextNode(' ');
			next.parentNode.insertBefore(space, next);
		}
		while (next = next.nextSibling);
	}
	
	
	function _markTroubleChars(text){
		text = text.replace("'", "zoteroapostrophe");
		return text;
	}
	
	
	function _restoreTroubleChars(text){
		text = text.replace("zoteroapostrophe", "'");
		return text;
	}
}
