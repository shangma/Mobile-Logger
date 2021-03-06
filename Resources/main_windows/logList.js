/*
 * Mobile Logger. Record geotagged sensor values on a mobile device.
 * Copyright (C) 2010 Robert Carlsen
 *
 * This file is part of Mobile Logger.
 *
 * Mobile Logger is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 * 
 */

// the log file list viewer

function LogWindow(title) {
    
    var self = Ti.UI.createWindow({
        navBarHidden: true
    });
    
    var logWindow = Ti.UI.createWindow({
        title : title,
        barColor : orangeColor,
        backgroundColor:'#ccc'
    });
    
    var nav = Ti.UI.iPhone.createNavigationGroup({
        window: logWindow
    });
    
    self.add(nav);
    
    ///---///
    
    // variables in this class
    var detailWindow;
    var retinaDisplay = (Ti.Platform.displayCaps.density == 'high');
    var imagesPath = Titanium.Filesystem.resourcesDirectory + '/images/';
    
    var selectedEvents = [];    
    var isExporting = false;
    
    // add an activity indicator 
    // use this for slow loading stuff.
    var actInd = Titanium.UI.createActivityIndicator();
    
    // activity indicator should be light if it's on the orange navbar
    actInd.style = Titanium.UI.iPhone.ActivityIndicatorStyle.LIGHT;
    logWindow.setRightNavButton(actInd);

    
    function sendLog(params){
        Ti.API.info('In the sendLog() method');
        var format = params.format;
        var eventID = params.eventID;
    
        // format: [json, csv, gc, ...]
        if(format == null) { format = Ti.App.Properties.getString('exportFormat','csv'); }
        if(eventID == null) { eventID = false; }
    
        if(isExporting) { return; } // don't try sending again if we're already sending
        // TODO: invoke an action sheet with options for sending the data
        // at the moment, just back to emailing off an attachment
    
        // some more checking...ensure that an upload service has been selected if asking for the 'upload' format:
        if(format == 'upload' && 'undefined' == Ti.App.Properties.getString('uploadService',"undefined")) {
            Ti.UI.createAlertDialog({
                title:   'Not configured',
                message: 'Please set up the upload service in Settings.'
            }).show();
            return;
        }
    
        var eventListArray = [];
    
        // fall back on using the selectedEvents list if an eventID isn't explicitly defined
        if(!eventID) {
            // display an alert if there are no rows selected
            // (or, if more than one is selected while i sort out that bug)
            if(selectedEvents.length < 1) {
                Ti.UI.createAlertDialog({
                    title:'Select Log',
                    message:"Please select a log file to send."
                }).show();
                return;
            } else if (selectedEvents.length > 1) {
                Ti.UI.createAlertDialog({
                    title:'Select one log',
                    message:"Select one log to send at a time. \n *TODO: this is a bug*"
                }).show();
                return;
            }
            
            for (var i = 0; i < selectedEvents.length; i++) {
                var evt = selectedEvents[i];
                eventListArray.push(evt);//"'"+evt+"'"); // trying to get this query to work.
                Ti.API.info('eventID: '+selectedEvents[i]);
            };
        } else {
            // just use the one provided eventID
            eventListArray.push(eventID);
        }
    
        // display an activity indicator
        var activity = Ti.UI.createActivityIndicator();
        activity.show();
    
        // TODO: move all of the database and parsing work until after the selected
        // exporting mechanism has been vetted...it is stupid to query the data,
        // process it, *then* realize that it can't go anywhere.
    
        // disable the send button while the export is preparing
        //sendButton.enabled = false;
        //sendButton.touchEnabled = false;
        isExporting = true;
        var useDeviceID = Ti.App.Properties.getBool('omitDeviceID',false);
    
        // retrieve the rows and setup an email message
        var sampleData;
        var logDB = Ti.Database.open("log.db");
    
        Ti.API.info('Selected Events list: '+eventListArray.join());
        var eventList = eventListArray.join();
        
    
        // i think that each of these items needs to be surrounded by quotes
        //var rows = logDB.execute('SELECT * FROM LOGDATA WHERE EVENTID IN (?)',eventList);
        //var rows = logDB.execute('SELECT * FROM LOGDATA WHERE EVENTID = ?',eventListArray[0]);
        var rows = logDB.execute('SELECT * FROM LOGMETA WHERE EVENTID = ?',eventListArray[0]);
        var logid = rows.fieldByName('logid');
    
        // also want to insert the event and device id into the exported data:
        var selectedEventID = rows.fieldByName('eventid');
        var deviceID = rows.fieldByName('deviceid');
        var startDate =  rows.fieldByName('startdate');
    
        rows.close();
    
        // convert to a Date object
        startDate = new Date(startDate*1000);
    
        rows = logDB.execute('SELECT * FROM LOGDATA WHERE logid = ?',logid);    
        // the rowCount seems to be limited to 1000 rows. why?
        // The problem seems alleviated after two changes:
        // 1. commented out the getRowCount() call.
        // 2. changed the execute statement to 'EVENTID = ?', eventListArray[0]
        // Not sure which, if either, of these did the trick.
        //
        //Titanium.API.info('Samples retrieved from db: ' + rows.getRowCount());
        //Titanium.API.info('Rows affected: ' + logDB.rowsAffected);
    
        // TODO: group the rows by eventID
        var tmpData=[];
        while(rows.isValidRow()){
            var thisData = JSON.parse(rows.fieldByName('DATA'));
    
            // insert the extra fields:
            // couchdb doc id - to prevent duplicates
            thisData._id = rows.fieldByName('_id');
    
            // hash for event id
            thisData.eventID = selectedEventID;
    
            // only include device id if premitted by user
            if(!useDeviceID){
                thisData.deviceID = deviceID;
            } else {
                thisData.deviceID = -1;
            }
    
            //Ti.API.info('data: '+JSON.stringify(thisData));
            tmpData.push(thisData);
            rows.next();
        };
        rows.close();
        logDB.close();
    
        Ti.API.info('log row count: '+tmpData.length);
    
        // here's the logic branch for uploading to the db rather than export via e-mail
        //
        if(format == 'upload') {
            // TODO: would like to include a progress bar here:
            try {
                Ti.API.info('about to start a bulk upload');
    
                var manager = new uploadManager(detailWindow);
                
                // if using fusion tables, test creating a new table id:
                if (Ti.App.Properties.getString('uploadService') == 'fusionTables') {
                    
                    // this is for the "meta" index table...which can be used to aggregate the individual log tables.
                    // disabling for now....the meta requests need to be updated to the new API / authentication
                    /*
                    var metaStuff = {
                        'description':'Mobile Logger Data',
                        'startdate':startDate.getTime(),
                        'eventID':selectedEventID,
                        'samples':tmpData
                        };
                    makeFusionTablesMetaRequest(packageFusionTablesMetaData(metaStuff));
                    */
                   
                    if(Ti.App.Properties.getBool('googleFusionCreateNewTables',true)) {
                        var tableName = 'Mobile Logger: '+startDate.format('yyyy-mm-dd_HH-MM-ss_Z');
                        manager.createNewTable(tableName,function(tableID) { manager.bulkUploadBatch(tmpData, tableID); });
                    }
                    else {
                        // will need to specify a table id here...store it in the local META table?
                        manager.bulkUploadBatch(tmpData);
                    }
                }
                else {
                        // NOP ...no other services currently defined.
                        return;
                }
                Ti.API.info('just started a bulk upload');
            } catch(err) {
                Ti.API.info('There was an error with bulkUpload()');
                var alertDialog = Titanium.UI.createAlertDialog({
                    title: 'Upload Problem',
                    message: 'There was a problem. Check your network connection.',
                    buttonNames: ['OK']
                });
                alertDialog.show();
            }
        }
        else {
            // export the data in a selected format:
            var tmpDataString;
            switch(format) {
                case 'gpx':
                    // GPX file format export
                    tmpDataString = exportGPXfile(tmpData);
                    break;
                case 'gc':
                    // GC file format export
                    tmpDataString = exportGCfile(tmpData);
                    break;
                case 'csv':
                    // CSV file format export
                    tmpDataString = exportCSV(tmpData);
                    break;
                case 'json': 
                    // much more robust approach to create a json string
                    tmpDataString = JSON.stringify(tmpData);
                    break;
                default:
                    // much more robust approach to create a json string
                    tmpDataString = JSON.stringify(tmpData);
            }
     
            // naive attempt to create the json string
            //var tmpDataString = '['+ tmpData.join(',\n') +']'; // create a JSON string
    
            // ok, now construct the email window
            var emailView = Ti.UI.createEmailDialog();
            
            if(!emailView.isSupported()) {
                var dialog = Ti.UI.createAlertDialog({
                    title: 'Cannot Export',
                    message: 'Please set up a default e-mail account.',
                    ok: 'OK'
                }).show();
                return;
             }
               
            emailView.barColor = orangeColor;
            emailView.setSubject(' Log data');
    
            if(tmpDataString) {
                // TODO: add as a file attachment, rather than a string.
                // emailView.setMessageBody(tmpDataString);
                emailView.setMessageBody('Log file attached in '+format+' format.');
    
                // this is a huge string
                //Ti.API.info('output string: '+tmpDataString);
    
                // Save the data as a temp file, the attach to an e-mail:
                // So this all works...for now. Maybe they'll change the 
                // methods in a future release.
                // For the moment, though...does the temp dir clear itself?
                var tempFile = Ti.Filesystem.createTempFile();
                Ti.API.info('Created temp file: '+tempFile.path);
    
                // construct a filename based on the date
                // TODO: look to see if the log has already been exported?
                // what about a log that has had more data added to it?
                // There has to be a better way to replace these strings or to build the name.
                var dateString = startDate.format('yyyy-mm-dd_HH-MM-ss_Z');
                Ti.API.info(dateString);
                var outfilename = 'Log_'+dateString+'.'+format;
    
                var result = tempFile.move(tempFile.getParent()+outfilename);
                Ti.API.info('move result: '+result);
                Ti.API.info('renamed the temp file to: '+tempFile.name);
    
                tempFile = Ti.Filesystem.getFile(tempFile.getParent(),outfilename);
                tempFile.write(tmpDataString);
                Ti.API.info('wrote to temp log file: '+tempFile.resolve());
    			
                // Compress the newly created temp file
                var zipFilePath;
                try {
                    //Run some code here
                    Ti.API.info('about to compress log file');
                    zipFilePath = Ti.Compression.compressFile(tempFile.resolve());
                    Ti.API.info('zip file path: '+zipFilePath);
                } catch(err) {
                    //Handle errors here
                    Ti.API.info('Problem with Compression module');
                }
               
    
                if(zipFilePath) { // it was successful, attach this
                    emailView.addAttachment(Ti.Filesystem.getFile(zipFilePath));
                }
                else {
                    emailView.addAttachment(tempFile);
                }
    
                //var tempContents = tempFile.read();
                //Ti.API.info('temp file contents: '+tempContents.text);
    
                // Do we need to clean up after ourselves?
                // Does the filesystem clean up the temp dir?
                //tempFile.deleteFile();
                //Ti.API.info('deleted temp file at: '+tempFile.resolve());
    
                // Add the log as an attachment to the e-mail message
                //emailView.addAttachment(tempFile);
    
                emailView.addEventListener('complete',function(e)
                {
                    if (e.result == emailView.SENT)
                    {
                        // TODO: this isn't really necessary, is it?
                        // alert("Mail sent.");
                    }
                    else if(e.result == emailView.FAILED)
                    {
                        var alertDialog = Titanium.UI.createAlertDialog({
                            title: 'Problem',
                            message: 'There was a problem. Check your network connection.', // DEBUG: '+e.result,
                            buttonNames: ['OK']
                        });
                        alertDialog.show();
                    }
                });
                emailView.open();
            }
            else {
                // display an alert
                var errorAlert = Ti.UI.createAlertDialog({
                    title:'Export error',
                    message:'There was an error with data export. Try another format.'
                });
                errorAlert.show();
            }
        }
    
        // hide the activity indicator
        activity.hide();
    
        // enable the send button
        //sendButton.enabled = true;
        //sendButton.touchEnabled = true;
        isExporting = false;
    
        return true;
    };

    
    // this isn't being used at the moment
    // TODO: add an activity meter.
    var data = [
    	{title:'Log file loading...'}
    ];
    
    // create a table view for the logs
    var logTable = Ti.UI.createTableView();
    // set a flag to fix a bug where double tapping a row causes the detail page to load twice
    var isLoadingDetail = false;
    var detailPageCount = 0; //only ever want this to be <=1
    
    // don't do anything on click, singletap only.
    logTable.addEventListener('click',function(){});
    
    //logTable.addEventListener('click',function(e) 
    //{
    //    // create a child view with the sample data
    //    // TODO: organize the data into events
    //    // inspect each event in the child view
    //   
    ///*
    //    // because the android doesn't have a navbar with buttons,
    //    // use the options dialog (action sheet) to reveal
    //    // log inspection and upload functions
    //    var optionsDialog = Titanium.UI.createOptionDialog({
    //        options:['Inspect data', 'Email Log', 'Delete Log', 'Cancel'],
    //        destructive:2,
    //        cancel:3,
    //        title:'Manage Log'
    //    });
    //
    //
    //    // TODO: add a listener to conditionally act on the response.
    //    // This may be better suited to display differently based on each platform's
    //    // UX paradigms.
    //    optionsDialog.addEventListener('click',function(oe){
    //        // these properties aren't being provided correctly.
    //        if(oe.cancel == true) { 
    //            Ti.API.info('Cancel button pressed');
    //            return; 
    //        }
    //        if(oe.destructive == true) {
    //            // delete this log file
    //            // forward the event to the delete listener
    //            Ti.API.info('Delete Log button pressed.');
    //            logTable.fireEvent('delete',e);
    //            Ti.API.info('fired a synthesized delete event to logTable');
    //        } else {
    //            switch(oe.index) {
    //                case 0:
    //                    Ti.API.info('Button 0 pressed.');
    //                    // Inspect this log data 
    //                    displayDetail();
    //                    break;
    //                case 1:
    //                    Ti.API.info('Button 1 pressed.');
    //                    // email / upload this log
    //                    actInd.show();
    //                    toggleSelection(true);
    //                    sendLog();
    //                    toggleSelection(false);
    //                    actInd.hide();
    //                    break;
    //                case 2:
    //                    // delete this log file
    //                    // forward the event to the delete listener
    //                    Ti.API.info('Delete Log button pressed for event: '+e.row.eventID);
    //                    deleteEvent(e.row.eventID);
    //                    toggleSelection(false);
    //                    break;
    //                case 3:
    //                    Ti.API.info('Cancel button pressed');
    //                    toggleSelection(false);
    //                    break;
    //
    //                default:
    //                    Ti.API.info('Default case in options dialog.');
    //                    // this shouldn't happen
    //                    toggleSelection(false);
    //                    return;
    //            }
    //        }
    //
    //    });
    //
    //
    //    // Ti.API.info('Showing the options dialog');
    //    // optionsDialog.show();
    //*/
    //
    //    // disable the double tap and showing the same log twice
    //    if(isLoadingDetail == true) return;
    //    isLoadingDetail = true;
    //
    //    // no longer displaying the action sheet...
    //    // just reveal the detail page
    //    displayDetail();
    //
    //       
    //    function toggleSelection(force) {
    //        // toggle the checked status of this row
    //        if(force == null) // actually perform a toggle
    //        {
    //            force = (e.row.hasCheck == null || e.row.hasCheck == false);
    //        }
    //
    //       if(force === true){ // (e.row.hasCheck == null || e.row.hasCheck == false)) {
    //           var data = e.row;
    //           //logTable.updateRow(e.index,data);
    //            data.hasCheck = true;
    //            //data.hasDetail = false;
    //
    //            var evt = data.eventID;
    //            selectedEvents.push(evt);
    //
    //            Ti.API.info('row '+e.index+' selected. ('+data.eventID+')');
    //       } else {
    //           var data = e.row;
    //           //data.hasDetail = true;
    //           data.hasCheck = false;
    //           //logTable.updateRow(e.index,data);
    //           
    //           // remove this selected item
    //           // TODO: change this to use indexOf()
    //           for (var i = 0; i < selectedEvents.length; i++) {
    //               if(selectedEvents[i] == data.eventID) {
    //                selectedEvents.splice(i,1); // remove this element
    //                Ti.API.info('row '+e.index+' deselected. ('+data.eventID+')');
    //               }
    //           };
    //       }
    //    }
    //
    //});
    //
    
    
    
    
    // simple padding function
    function pad2(number) {
         return (number < 10 ? '0' : '') + number;
    }
    
    // Methods for the log detail view
    // set up in a grouped table view.
    // Table header is the file name (startdate)
    //
    // a static map view with annotations for the start and end of the ride
    // when clicked will push a live, native map view
    // Alternatively: set touchEnabled to false when in the table view
    // then switch to true when fullscreen?
    // use the same map view in the table cell, and added to a new window when pushed fullscreen
    //
    // section with summary data (label / value)
    // delete button at the bottom of the table
    // similar to the delete contact or wifi network from apple apps
    //
    // Map:
    // create a map view, but only show the static (toImage()) image in the table
    // when clicked, push it to the current window using an animated transition
    // TODO: add a subset of the samples as annotations to depict the route?
    // use the 'complete' event handler to trigger the generation of the static image
    // put a spinner activity indicator in the cell while loading.
    
    function addMapRow (logData) {
        //Ti.API.info('In addMapRow()');
        
        var mapHeight = 200;
    
        var row = Ti.UI.createTableViewRow({height:mapHeight});
        if(Ti.Platform.name == 'iPhone OS'){
            row.selectionStyle = Ti.UI.iPhone.TableViewCellSelectionStyle.NONE;
        }
        //Ti.API.info('Created row container');
    
        // array of point objects for drawing the route polyline
        // in the form of {latitude:,longitude:}
        var routePoints = [];
    
        // Create the annotations:
        function createFirstAnnotation(data) {
            return Titanium.Map.createAnnotation({
                        latitude:data.lat,
                        longitude:data.lon,
                        title:"Log start",
                        subtitle:new Date(data.timestamp).toLocaleString(),
                        pincolor:Titanium.Map.ANNOTATION_GREEN,
                        animate:true,
                        //leftButton: '../images/appcelerator_small.png',
                        myid:1 // CUSTOM ATTRIBUTE THAT IS PASSED INTO EVENT OBJECTS
                    });
        }
        
        // may not have this point...
        var firstPoint = null;
        if(logData.first.lat && logData.first.lon) {
            firstPoint = createFirstAnnotation(logData.first); 
        }
        //Ti.API.info('Added pin at: ('+firstPoint.longitude+','+firstPoint.latitude+')');
        
        var lastPoint = null;
        if(logData.last.lat && logData.last.lon) {
            lastPoint = Titanium.Map.createAnnotation({
                latitude:logData.last.lat,
                longitude:logData.last.lon,
                title:"Log end",
                subtitle:new Date(logData.last.timestamp).toLocaleString(),
                pincolor:Titanium.Map.ANNOTATION_RED,
                animate:true,
                //leftButton: '../images/appcelerator_small.png',
                myid:2 // CUSTOM ATTRIBUTE THAT IS PASSED INTO EVENT OBJECTS
            });
        }
        //Ti.API.info('Added pin at: ('+lastPoint.longitude+','+lastPoint.latitude+')');
    
        
        // now, create all the other annotations.
        var dataPoints = [];  // annotations
        for (var i = 0; i < logData.data.length; i++) {
            var d = logData.data[i];
            
            // only include this data point if location data is here.
            if(!d.lat || !d.lon) { continue; }
            
            // if the firstPoint is null...then use the first available data point:
            if(firstPoint == null) {
                firstPoint = createFirstAnnotation(d);
            }
            
            // make a speed note
            var speedString;
            
            // using Math.max() to filter out the -1 values from bad speed readings
            var metersPerSecond = (!d.speed) ? 0 : Math.max(0,d.speed);
            if(Ti.App.Properties.getBool('useMetric',false)) {
                speedString = toKPH(metersPerSecond).toFixed(2) +' km/h';
            }else{
                speedString = toMPH(metersPerSecond).toFixed(2) + ' mph';
            }
            var point = Ti.Map.createAnnotation({
                latitude:d.lat,
                longitude:d.lon,
                title:"Data Point",
                subtitle:speedString + ((d.dbspl != null) ? ' | '+d.dbspl+' dB' : ''),
                pincolor:Titanium.Map.ANNOTATION_PURPLE,
                animate:false,
                myid:2+i // CUSTOM ATTRIBUTE THAT IS PASSED INTO EVENT OBJECTS
            });
            dataPoints.push(point);
            
            var entry = {latitude:d.lat,longitude:d.lon};
            routePoints.push(entry);
        };
        //Ti.API.info('Created anntations');
    
        // add the first point to the route point array:
        if(firstPoint) {
            routePoints.unshift({
                latitude:firstPoint.latitude,
                longitude:firstPoint.longitude
            });
        }
        
        // add the last point to the route point array:
        if(lastPoint) {
            routePoints.push({
                latitude:lastPoint.latitude,
                longitude:lastPoint.longitude
        });
        }
        
        // create the map view:
        var map = Ti.Map.createView({
            width:300,height:mapHeight,
            borderRadius:10,
            borderWidth:1,
            borderColor:'#999',
            touchEnabled:false,
            mapType:Ti.Map.STANDARD_TYPE
        });
        if(firstPoint) {map.addAnnotation(firstPoint);}
        if(lastPoint) {map.addAnnotation(lastPoint);}
        //Ti.API.info('Created map view');
    
    
        // create route object:
        var route = null;
        if(routePoints.length > 0) {
            route = {
                name:"Log",
                points:routePoints,
                color:"purple",
                width:(retinaDisplay) ? 8 : 4 // this needs to be adjusted for non-Retina displays  
            };
            
            // add a route
            map.addRoute(route);
        }
        
        map.userLocation = false;
        //map.annotations = [firstPoint,lastPoint];
        //Ti.API.info('Added annotations to the map');
    
        // region
        // to get the region, look for the extents?
        // or, more simply use the first and last points
        // calculate the midpoint for the region center
        // and half the distance between them (in degrees) (+ 10%?) as the deltas
        var p1 = (firstPoint) ? {lat:firstPoint.latitude, lon:firstPoint.longitude} : {lat:null, lon:null} ;
        var p2 = (lastPoint) ? {lat:lastPoint.latitude, lon:lastPoint.longitude} : {lat:null, lon: null} ;
    
        // sanity checking:
        var setRegion = true;
        if(p1.lon == null || p1.lat == null) {
            p1 = p2;
        } 
        if(p2.lon == null || p2.lat == null) {
            p2 = p1;
            
            // if p2 is still null then neither point was valid
            if(p2.lon == null || p2.lat == null) { setRegion = false; }
        }
        
    //    p1.lat = (p1.lat == null) ? 0 : p1.lat;
    //    p2.lat = (p2.lat == null) ? 0 : p2.lat;
    //    p1.lon = (p1.lon == null) ? 0 : p1.lon;
    //    p2.lon = (p2.lon == null) ? 0 : p2.lon;
    
        function makeRegion (p1,p2) {
            var midpoint = { lon:parseFloat(p1.lon) + (p2.lon - p1.lon)/2,
                             lat:parseFloat(p1.lat) + (p2.lat - p1.lat)/2 };
            var delta = { lon: Math.max(0.01,Math.abs(p2.lon - p1.lon)),
                          lat: Math.max(0.01,Math.abs(p2.lat - p1.lat)) };
            //Ti.API.info('Got the region: '+ JSON.stringify(midpoint) +', '+JSON.stringify(delta));
    
            var region = {  latitude: midpoint.lat,
                            longitude: midpoint.lon,
                            latitudeDelta: delta.lat,
                            longitudeDelta: delta.lon };
            return region;
        }
        if(setRegion) {
            map.region = makeRegion(p1,p2);
            map.regionFit = true;
        }
    
        //Ti.API.info('Set the map region');
    
        row.add(map);
    
        // add a detail disclosure button
        var detailButton = Ti.UI.createButton({
            backgroundImage: imagesPath+'detail.png',
            right:10,bottom:10,
            width:29,height:29
        });
    
        // TODO: add event listener for click to display the fullscreen map
        // TODO: use logData to center the map on the bounds of the start / end locations of the ride
        detailButton.addEventListener('click',function(e){
            //Ti.API.info('In the map row click event');
            var mapwin = Ti.UI.createWindow({
                barColor:orangeColor,
                title:'Samples'
                });
            var bigMap = Ti.Map.createView();
            bigMap.touchEnabled = true;
            bigMap.height = mapwin.getHeight();
            bigMap.width = mapwin.getWidth();
            bigMap.regionFit = true;
            bigMap.region = map.region;
            bigMap.mapType = Ti.Map.STANDARD_TYPE;
            
            if(firstPoint) { dataPoints.push(firstPoint); }
            if(lastPoint) { dataPoints.push(lastPoint); }
    
            // add all the other annotations
            if(dataPoints.length > 0) {
                bigMap.annotations = dataPoints;
            }
            
            // add the route line
            if(route) {
                bigMap.addRoute(route);
            }
            
            mapwin.add(bigMap);
            //Ti.API.info('added the map view to the new map window');
    
            mapwin.addEventListener('close',function(e){
                // remove the mapview
                mapwin.remove(bigMap);
            });
    
            nav.open(mapwin,{animated:true});
            //Ti.API.info('Should have opened the map window');
        });
        
        // only add the detail button if there are annotations / route
        if(dataPoints.length > 0 || route) {
            row.add(detailButton); 
        }
        row.className = 'maprow';
    
        //Ti.API.info('Returning map row');
        return row;
    }
    
    function addSummaryRow (label,value) {
        // have some logic for dealing with empty values?
        if(label == null) { label = 'Summary'; }
        if(value == null) { value = ''; }
    
        var row = Ti.UI.createTableViewRow({height:50});
        row.backgroundColor = '#fff';
    
        // add a label to the left
        // should be bold
        var cellLabel = Ti.UI.createLabel({
            text:label,
            font:{fontSize:18,fontWeight:'bold'},
            left:10,
            height:24
        });
        row.add(cellLabel);
        //Ti.API.info('Created (and added) the title to the row');
    
        // add the summary value
        var cellValue = Ti.UI.createLabel({
            text:value,
            font:{fontSize:16},
            textAlign:'right',
            right:10,
            height:22
        });
        row.add(cellValue);
        //Ti.API.info('Created (and added) the value label to the row');
    
        row.className = 'summaryrow';
    
        //Ti.API.info('Returning a summary row for: '+label);
        return row;
    }
    
    
    function deleteEvent(params) {
        // use parameters
        //{eventID,closeWindow,confirm}
        var eventID = params.eventid;
        var closeWindow = params.closeWindow;
        var confirmDelete = params.confirmDelete;
    
        if(eventID == null) { return; }
        if(closeWindow == null) { closeWindow = false; }
        if(confirmDelete == null) {confirmDelete = true; }
    
        // Don't delete a currently recoring log
        if(eventID == Ti.App.Properties.getString('eventid','')) {
            // display and alert and return
            var alertDialog = Ti.UI.createAlertDialog({
                title:'Currently Logging',
                message:'Unable to delete this log while recording.',
                buttonNames:['OK']
            });
            alertDialog.show();
            
            // refresh the list if we're in the log list view
            if(!Ti.UI.currentWindow.isDetailWindow) { 
                // TODO: fix how to refresh the table without callong loadLogs() 
                //loadLogs(); 
                
                
                // restore log table to the current data
                if(Ti.Platform.name == 'iPhone OS') {
                    logTable.setData(data,{animationStyle:Titanium.UI.iPhone.RowAnimationStyle.FADE});
                } else {
                    logTable.setData(data);
                }
            }
            return;
        }
    
        function deleteSelectedEvent() {
            // open the DB
            var logDB = Ti.Database.open("log.db");
    
            // run the SQL statement to delete the row.
            var rows = logDB.execute('SELECT logid FROM LOGMETA WHERE eventid = ?',eventID);
            var logid = rows.fieldByName('logid');
            rows.close();
    
            logDB.execute('DELETE FROM LOGDATA WHERE logid = ?',logid);
            logDB.execute('DELETE FROM LOGMETA WHERE logid = ?',logid);
            // is there a way to verify the process?
    
            logDB.close();
           
            Ti.API.info('deleted eventID: '+eventID);
    
            // if we're in the detail page..then have to close the current window
            Ti.API.info('This is the detail window: '+JSON.stringify(closeWindow));
            if(closeWindow != false) {
                Ti.API.info('About the close the detail window since the log was deleted');
                closeWindow.close();
            }
    
            // trigger a focus event, which will update the logTable data
            //win.fireEvent('focus');
    
        }
    
    
        if(confirmDelete) {
        // remove the log data from the db
        // but first confirm with an alert
        var alertDialogDelete = Ti.UI.createAlertDialog({
            title:'Delete Log',
            message:'Are you sure you want to delete this log data?',
            buttonNames: ['OK','Cancel']
        });
        alertDialogDelete.addEventListener('click',function(e) {
            if(e.index == 0){
                // the OK button was clicked, delete this data.
                deleteSelectedEvent();
            }
            
            // deleting in the detail window will cause the logtable view to 
            // gain focus after the delete (and thus loadLogs will get called)
            // so, we don't need to force a refresh here.
            //
            // have to refresh the table data...is there another way?
            //Ti.API.info('Reloading log list from alert dialog');
            //loadLogs();
            
            // restore log table to the current data
            //logTable.setData(data,{animationStyle:Titanium.UI.iPhone.RowAnimationStyle.UP});
        });
    
        alertDialogDelete.show();
    
        } else {
            // just do it
            deleteSelectedEvent();
        }
    };
    
    function displayDetail(rowData) { 
        detailWindow = Titanium.UI.createWindow({
            title:'Log Summary',
            backgroundColor:'#ccc',
            barColor:orangeColor
        });
    
        // set a custom property to be able to identify this as a detail window
        detailWindow.isDetailWindow = true;
    
        // still trying to eliminate the double detail page
        detailWindow.addEventListener('close',function(){ detailPageCount--; });
                
        // add a send action button
        var sendButton = Titanium.UI.createButton();
        // use special button icon if on iPhone
        if(Ti.Platform.name == 'iPhone OS'){
            //sendButton.systemButton =Titanium.UI.iPhone.SystemButton.ACTION;    
            sendButton.width = 43;
            sendButton.height = 30;
            sendButton.backgroundImage = imagesPath +'up_btn.png';
            sendButton.backgroundDisabledImage = imagesPath +'up_btn_disabled.png';
            sendButton.backgroundSelectedImage = imagesPath +'up_btn_selected.png';
            //sendButton.selectedColor = '#000';
            //sendButton.title = 'Send';
            detailWindow.rightNavButton = sendButton;
        } else {
            sendButton.title = 'Send';
            // TODO: figure out a solution for android
            // Menu?
        }
        //TODO: should this display the options dialog?
        sendButton.addEventListener('click',function(){
            // just testing
            //win.uploadProgress(detailWindow);
            
            Ti.API.info('Send button pressed. isExporting == '+isExporting);
            
            // temporarily disable the button to prevent a double-tap
            sendButton.enabled = false;
            sendButton.touchEnabled = false;
    
            // set up and display an action sheet with upload choices:
            var optionsDialog = Titanium.UI.createOptionDialog({
               options:['Upload', 'Email', 'Cancel'],
               cancel:2,
               title:'Export Log'
            });
    
    
            // TODO: add a listener to conditionally act on the response.
            // This may be better suited to display differently based on each platform's
            // UX paradigms.
            optionsDialog.addEventListener('click',function(oe){
               // these properties aren't being provided correctly.
               if(oe.cancel == true) { 
                   Ti.API.info('Cancel button pressed');
                   return; 
               }
                   switch(oe.index) {
                       case 0: // upload
                           Ti.API.info('Button 0 pressed.');
                           sendLog({format:'upload',eventID:rowData.eventID});
                           break;
                       case 1: // email
                           Ti.API.info('Button 1 pressed.');
                           sendLog({eventID:rowData.eventID});
                           break;
                       case 2:
                           Ti.API.info('Cancel button pressed');
                           break;
                       default:
                           Ti.API.info('Default case in options dialog.');
                           return;
               }
            });
    
           // Ti.API.info('Showing the options dialog');
           optionsDialog.show();
    
    
            setTimeout(function() {
                sendButton.enabled = true;
                sendButton.touchEnabled = true;
            },1000);
        });
    
        // This is where we have to query the database and calculate and metrics needed
        // TODO: *very* close to having to extract the log data into columns
        var logDB = Ti.Database.open('log.db');
    
        // get the first item
        var rows = logDB.execute('SELECT * FROM LOGDATA WHERE logid = ? ORDER BY ROWID ASC LIMIT 1',rowData.logID);    
        var firstSample = JSON.parse(rows.fieldByName('DATA'));
        rows.close();
        // get the last item
        rows = logDB.execute('SELECT * FROM LOGDATA WHERE logid = ? ORDER BY ROWID DESC LIMIT 1',rowData.logID);    
        var lastSample = JSON.parse(rows.fieldByName('DATA'));
        rows.close();
    
        // get every nth item
        // assuming sequential ROWISs
        rows = logDB.execute('SELECT * FROM LOGDATA WHERE (logid = ? AND (ROWID % 10) = 0) LIMIT -1 OFFSET 1',rowData.logID);
        var tmpdataset = [];
        while(rows.isValidRow()){
            tmpdataset.push(rows.fieldByName('DATA'));
            rows.next();
        }
        Ti.API.info('Got remaining data points, count: '+tmpdataset.length);
    
        rows.close();
        logDB.close();
        Ti.API.info('Got the first and last items from the current log');
    
        Ti.API.info('First sample: '+ JSON.stringify(firstSample));
        Ti.API.info('Last sample: '+ JSON.stringify(lastSample));
    
        // now parse that data
        var dataset = []; 
        for(var d in tmpdataset){
            if(tmpdataset.hasOwnProperty(d)){
                dataset.push(JSON.parse(tmpdataset[d]));
            }
        }
        Ti.API.info('Parsed dataset has count: '+dataset.length);
    
        // construct the table view with the groupings here.
        var summaryTable = Ti.UI.createTableView({
            backgroundColor:'#ccc',
            headerTitle:rowData.name,
            style:Titanium.UI.iPhone.TableViewStyle.GROUPED
        });
    
        // create the data for the table
        var summaryData = [];
        var mapRow = addMapRow({first:firstSample,last:lastSample,data:dataset}); // TODO: figure a better data delivery method
    
        //mapRow.header = rowData.title;
        summaryData.push(mapRow); //TODO: pass something which can be used to get the ride location
       
        //var metricsSection = Titanium.UI.createTableViewSection();
        //metricsSection.headerTitle = "Metrics";
    
        var firstRow = addSummaryRow('Duration',rowData.durationString);
        firstRow.header = "Metrics";
        summaryData.push(firstRow);
      
        // TODO: how to change this if the distance units are changed?
        summaryData.push(addSummaryRow('Distance',rowData.distanceString));
        summaryData.push(addSummaryRow('Average speed',rowData.avgSpeedString));
        //summaryData.push(addSummaryRow('Altitude gain','xx'));
        //summaryData.push(addSummaryRow('Average loudness','xx'));
        //summaryData.push(addSummaryRow('Bumpiness factor','xx'));
    
        // add the delete log button
        // TODO: make this a big red button, and link to the delete logic
        // including the alert view prompts
        var deleteButton = Titanium.UI.createButton({
            title:'Delete Log',
            font:{fontSize:20,fontWeight:'bold'},
            height:45,
            width:300,
            backgroundImage:imagesPath + 'button_red-150x45.png',
            borderRadius:10
        });
        deleteButton.addEventListener('click',function() {
            Ti.API.info('Delete button (detail view) clicked for eventID: '+rowData.eventID);
            deleteEvent({eventid:rowData.eventID,closeWindow:detailWindow}); // second arg to close the current window
            //Ti.API.info('Event should have been deleted');
        });
    
        var deleteRow = Ti.UI.createTableViewRow();
        deleteRow.header = ''; // nieve way to add a new section to the table
        deleteRow.add(deleteButton);
        summaryData.push(deleteRow);
    
        summaryTable.setData(summaryData);
        Ti.API.info('Created summaryTable and added summary data rows');
        
        detailWindow.add(summaryTable);
    
        nav.open(detailWindow,{animated:true});
    
        // hide the activity indicator
        rowData.actInd.hide();
    
        // reset the flag to allow another detail page to load
        //setTimeout(function() {isLoadingDetail = false;},1000);
    
    }
    
    function addLogRow(rowData) // should include title(date), duration, distance, eventID/logID (for detail view) 
    {
        //Ti.API.info('In the addLogRow() method');
        
        if(rowData == null) { return null; }
    
    	var row = Ti.UI.createTableViewRow({height:55});
        //Ti.API.info('Created a new row object');
    
        // add a label to the left
        // should be bold
        var cellLabel = Ti.UI.createLabel({
            text:rowData.title,
            font:{fontSize:15,fontWeight:'bold'},
            left:10,top:10,
            height:21
        });
        row.add(cellLabel);
        //Ti.API.info('Created (and added) the title to the row');
    
        // create a label for the subtitle
        // duration is millis
        var hour = Math.floor(rowData.duration / 1000 / 60 / 60);
        var min = Math.floor(rowData.duration / 1000 / 60) % 60;
        var sec = Math.floor(rowData.duration / 1000) % 60;
        var durationString = (hour > 0 ? hour +':' : '') + (hour > 0 ? pad2(min) : min) +':'+ pad2(sec);
        //Ti.API.info('Created the durationString: '+durationString);
    
        // distance / average
        var avgSpeedString;
        var distanceString;
        
        // don't divide by zero.
        var avgSpeedMetersPerSec = (rowData.duration <= 0) ? 0 : (rowData.distance / (rowData.duration / 1000.));
        
         if(Ti.App.Properties.getBool('useMetric',false)) {
            //Ti.API.info('Metric units');
            var distanceUnits = "km";
            var speedUnits = 'km/h';
    
            distanceString = toKM(rowData.distance).toFixed(2) +' '+distanceUnits;
            avgSpeedString = toKPH(avgSpeedMetersPerSec).toFixed(2) +' '+speedUnits;
        } else {
            //Ti.API.info('Imperial units');
            var distanceUnitsImperial = "mi";
            var speedUnitsImperial = 'mph';
    
            distanceString = toMiles(rowData.distance).toFixed(2) +' '+distanceUnitsImperial;
            avgSpeedString = toMPH(avgSpeedMetersPerSec).toFixed(2) +' '+speedUnitsImperial;
       }
       //Ti.API.info('Created the distanceString: '+distanceString);
    
        // combine the two to create the subtitle label
        // smaller and grey
        var subtitleLabel = Ti.UI.createLabel({
            text:durationString +' | '+distanceString,
            font:{fontSize:13},
            color:'#666',
            left:10,bottom:7
        });
        row.add(subtitleLabel);
        //Ti.API.info('Created (and added) the subtitle label to the row');
    
        // add these strings to the row object for easy retrieval in the detail view
        row.distanceString = distanceString;
        row.durationString = durationString;
        row.avgSpeedString = avgSpeedString;
    
        // also add data useful for retrieving the log later
        row.eventID = rowData.eventID;
        row.logID = rowData.logID;
        row.name = rowData.title;
    
        // add the activity indicator
        row.actInd = Titanium.UI.createActivityIndicator({
            left:250,
            style:Titanium.UI.iPhone.ActivityIndicatorStyle.DARK
        });
        row.add(row.actInd);
        row.actInd.hide();
    
        // add the child icon
        row.hasChild = true;
        //row.hasCheck = rowData.hasCheck;
    
    	row.className = 'logrow';
    
        row.addEventListener('click',function(e){
            if(detailPageCount>=1) { return; }
            detailPageCount++;
    
    //        row.touchEnabled = false;
    //        row.selectionStyle = Ti.UI.iPhone.TableViewCellSelectionStyle.NONE;
            
            // change the row disclosure into the activity spinner
            row.actInd.show();
            displayDetail(row);
    
    //        row.touchEnabled = true;
    //        row.selectionStyle = Ti.UI.iPhone.TableViewCellSelectionStyle.DEFAULT
        });
    
        //Ti.API.info('Finished setting up the row. Now returning it');
        return row;
    }
    
    
    
    // call up the log list from the database
    function loadLogs () {
        // display the activity indicator
        actInd.show();
        
        // open the database connection (create if necessary)
        var logDB = Ti.Database.open("log.db");
    
        Ti.API.info('Getting logs from db');
    
    
        // TODO: move the data base stuff into a class.
        
        // this should be streated by the setupDatabase() method
        //logDB.execute('CREATE TABLE IF NOT EXISTS LOGDATA (ID INTEGER PRIMARY KEY, EVENTID TEXT, DATA TEXT)');
    
        //var rows = logDB.execute('SELECT * FROM LOGDATA GROUP BY EVENTID');
        var rows = logDB.execute('SELECT * FROM LOGMETA ORDER BY startdate DESC');
    
        //Titanium.API.info('ROW COUNT = ' + rows.getRowCount());
        
        // TODO: group the rows by eventID
        var tmpData = [];
        var previousSelection = selectedEvents.slice(0);
        selectedEvents.splice(0,selectedEvents.length); // clear the list
    
        if(rows.getRowCount() > 0) {
            while(rows.isValidRow()){
                //var thisData = rows.fieldByName('DATA');
                //var thisObject = JSON.parse(thisData);
                var thisTimestamp = rows.fieldByName('startdate');
    
                var rowParams = {   title:new Date(thisTimestamp*1000).toLocaleString(), // only stored as seconds
                                    eventID:rows.fieldByName('eventid'),
                                    content:null,
                                    timestamp:thisTimestamp,
                                    duration:rows.fieldByName('duration'),
                                    distance:rows.fieldByName('distance'),
                                    logID:rows.fieldByName('logid')
                                    };
    
                /* // notes on creating custom row layouts
                row = Ti.UI.createTableViewRow();
                row.hasDetail = true;
                row.title = rows.field(1);
                row.leftImage = '../images/film/small/'+rows.fieldByName('small_img');
                data[rows.field(0)] = row;
                rows.next();
                */
    
                // look up the eventid in the selectedEvents array.
                if(previousSelection.indexOf(rowParams.eventID) >= 0) {
                    //Ti.API.info('Found previously selected event');
                    rowParams.hasCheck = true;
                    selectedEvents.push(rowParams.eventID); // restore this selection
                } else {
                    //Ti.API.info('Found unselected event');
                    //rowParams.hasDetail = true;
                }
    
                // trying to speed up the log list display
                // by eliminating the second iterator
                // maybe this will be bad for keeping the DB open too long.
                tmpData.push(addLogRow(rowParams));
                rows.next();
            };
        }
        rows.close();
        logDB.close();
    
        // generate the custom rows, and push them to the data:
        //for (var i = 0; i < tmpData.length; i++) {
            //tmpData[i] = addLogRow(tmpData[i]);
        //};
    
        // sort chronolocically:
        //tmpData.sort(compareTime);
    
        Ti.API.info('Got '+tmpData.length+' events');
        Ti.API.info('Selected events: '+selectedEvents);
    
        if(tmpData.length == 0) { 
            tmpData.push({title:'No Logs recorded.',touchEnabled:false});
        } else {
            logTable.editable=true;
        }
    
        // update the data container
        data = tmpData;
    
        Ti.API.info('Updating the iPhone log table');
        logTable.setData(tmpData);
    
        // hide the activity indicator
        actInd.hide();
    }
    
    // reload the logs when the window gains focus
    logWindow.addEventListener('focus',function() {
        loadLogs();
    });
    
    // utility function? better placed in the util.js file?
    function compareTime(a, b) {
        return b.timestamp - a.timestamp;
    }
    
    
    // add delete event listener
    logTable.addEventListener('delete',function(e)
    {
        // get the selected row's eventID
        var eventID = e.row.eventID;
        if (eventID == null ) {return;}
    
        // assume that the swipe, then click on delete is confirmation enough
        deleteEvent({eventid:eventID, confirmDelete:false});
    });
    
    // add the log table to the view.
    logWindow.add(logTable);

    return self;
}

module.exports = LogWindow;

