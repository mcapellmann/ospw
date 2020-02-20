// ©2020 FHNW Fachhochschule Nordwestschweiz
// written by Thomas Resch and Clemens Fiechter, Hochschule für Musik Basel, FHNW
// thanks to Ben Taylor for the NexusUI Library https://github.com/nexus-js/ui


var httpListeningPort = 80;
var connect = require('connect')
var http = require('http')
var app = connect().use(connect.static(__dirname)).listen(httpListeningPort)
var io = require('socket.io').listen(app);
var osc = require('node-osc')
var fs = require('fs')

var mixerPatch = 'patches/mixer_channellayout.pd';
var pdPatchToParse = '';
var selectedMiscPatch = '';

var onMainPage = true;
var patchLoaded = false;
var loadedPatchIndex;

var miscPatches = [];

var oscClient = new osc.Client('localhost', 57120);
console.log('osc client on 57120');

var oscServer = new osc.Server(4445, '0.0.0.0');
console.log('osc server on 4445');

function removeWidget(socket, name) {
  socket.emit('delete', name);
}

var ospwWidgets = [];

// used for automatic channel layout
var mixerWidgets = [];

var useChannels = false;
var channelWidth = 150;
var cellSize = 150;
var margin = 50;
var marginTop = 50;
var labelSpace = 50;

var defaultSize = {
  'width': 50,
  'height': 50
}

var dialSize = {
  'width': 50,
  'height': 50
}
var sliderSize = {
  'width': 50,
  'height': 175
}

var sliderLength = 200;

var numberBoxHeight = 30;
var channelCount = 0;

// used for binaural widget
var binauralWidgetCount = 8;
var listenersPerWidget = 8;
var binauralWidgets = [];

// used for interface creation of user (misc) patches
var miscWidgets = [];

readMiscFolder(false);
parsePatch(true);
prepareInterfaceBinaural();

function readMiscFolder(reload, socket) {
  path = './misc';

  fs.readdir(path, function(err, items) {
    miscPatches = items;
    if (reload) {
      socket.emit('createMiscMenu', miscPatches);
      console.log("Created the start page!");
    }
  });
}

function parsePatch(patchIsMixer, socket) {
  var omit = '/ospw/'.length;

  ospwWidgets = [];

  if (patchIsMixer) {
    pdPatchToParse = mixerPatch;
  }

  fs.readFile(pdPatchToParse, 'utf8', function(err, contents) {
    var i = 0;
    var ospwIndices = [];
    while (i != -1) {
      i = contents.indexOf('/ospw', i+1)
      if (i != -1) {
        ospwIndices.push(i);
      }
    }
    // check if comment 'use_channels' is present in file
    // if it is, we will make a channel layout
    if (contents.indexOf('use_channels') != -1) {
      useChannels = true;
    } else {
      useChannels = false;
    }

    if (useChannels) {
      // loop through all occurences of '/ospw ' in contents
      for (var i = 0; i < ospwIndices.length; i++) {

        // extract substring from contents with only the part after '/ospw' until ';'
        var indexAfterOmit = ospwIndices[i]+omit;
        var substrLength = contents.indexOf(';', ospwIndices[i])-indexAfterOmit;
        var tempStr = contents.substr(indexAfterOmit, substrLength);

        // split string into array containing details of the interface to be generated
        // form: [ 'channel_number', 'pos_in_channel', 'interface_type', 'name', 'init_value' ]
        var details = tempStr.split('/');

        // details[0] = parseInt(details[0]);

        currentWidget = {};
        currentWidget.channel_number = details[0];
        currentWidget.pos_in_channel = details[1];
        currentWidget.interface_type = details[2];
        currentWidget.name = details[3];
        currentWidget.init_value = details[4]
        currentWidget.top = 0;

        ospwWidgets.push(currentWidget);
      }
    } else {
      for (var i = 0; i < ospwIndices.length; i++) {
        // extract substring from contents with only the part after '/ospw' until ';'
        var indexAfterOmit = ospwIndices[i]+omit;
        var substrLength = contents.indexOf(';', ospwIndices[i])-indexAfterOmit;
        var tempStr = contents.substr(indexAfterOmit, substrLength);

        // split string into array containing details of the interface to be generated
        // form: [ 'x', 'y', 'interface_type', 'name', 'init_value' ]
        var details = tempStr.split('/');


        details[0] = parseInt(details[0]);
        details[1] = parseInt(details[1]);
        details[4] = parseFloat(details[4]);

        currentWidget = {};
        currentWidget.x = details[0];
        currentWidget.y = details[1];
        currentWidget.interface_type = details[2];
        currentWidget.name = details[3];
        currentWidget.init_value = details[4];

        ospwWidgets.push(currentWidget);
      }
    }

    if (patchIsMixer) {
      prepareInterfaceMixer();
    } else {
      prepareInterfaceMisc(socket);
    }
  });
}

function checkChannels() {
  var usedChannels = [];
  for (var i = 0; i < ospwWidgets.length; i++) {
    // reset top
    ospwWidgets[i].top = 0;

    // check if the channel of the current object is already used (= pushed to the usedChannels array)
    // if (usedChannels.includes(ospwWidgets[i].channel_number)) {

    var currentChannel = ospwWidgets[i].channel_number;

    // check the widgets before
    for (var j = 0; j < ospwWidgets.length; j++) {
      if (ospwWidgets[j].channel_number == currentChannel) {
        // check if the other widget (j) is above the current widget (i) (pos_in_channel should be smaller)
        if (ospwWidgets[j].pos_in_channel < ospwWidgets[i].pos_in_channel && i!=j) {
          // console.log("current widget: " + ospwWidgets[i].name);
          // console.log("pos in channel of " + ospwWidgets[j].name + ": " + ospwWidgets[j].pos_in_channel);

          // check the type of the item above the current one in the channel and add an offset
          var top;
          switch (ospwWidgets[j].interface_type) {
            case 'dial':
            top = labelSpace + dialSize.height + numberBoxHeight + 20;
            break;
            case 'slider':
            top = labelSpace + sliderSize.height + numberBoxHeight + 20;
            break;
          }
          ospwWidgets[i].top += top;
        }
      }
    }
    usedChannels.push(ospwWidgets[i].channel_number);
  }
  // TODO: check all the channels and make sorted array
  channelCount = Math.max.apply(Math, usedChannels);
}

function prepareInterfaceMixer() {
  if (useChannels) {
    checkChannels();
  }

  for (var i = 0; i < ospwWidgets.length; i++) {
    var osc_string;
    if (useChannels) {

      osc_string = '/ospw/' + ospwWidgets[i].channel_number + '/' + ospwWidgets[i].pos_in_channel + '/' + ospwWidgets[i].interface_type + '/' + ospwWidgets[i].name  + '/' + ospwWidgets[i].init_value;

      switch (ospwWidgets[i].interface_type) {
        case 'dial':
        var widget =
        {
          'type': ospwWidgets[i].interface_type,
          'name': osc_string,
          'x': (ospwWidgets[i].channel_number - 1)*channelWidth+margin,
          'y': ospwWidgets[i].top + labelSpace + marginTop,
          'size': [dialSize.width, dialSize.height],
          'min':0,
          'max':1,
          'value': ospwWidgets[i].init_value,
          'interaction': 'vertical',
          'mode': 'relative',
          'label_x': (ospwWidgets[i].channel_number - 1)*channelWidth,
          'label_y': ospwWidgets[i].top + marginTop,
          'label_text': ospwWidgets[i].name

        }
        break;
        case 'slider':
        var widget =
        {
          'type': ospwWidgets[i].interface_type,
          'name': osc_string,
          'x': (ospwWidgets[i].channel_number - 1)*channelWidth+margin,
          'y': ospwWidgets[i].top + labelSpace + marginTop,
          'size': [sliderSize.width, sliderSize.height],
          'min':0,
          'max':1,
          'value': ospwWidgets[i].init_value,
          'interaction': 'vertical',
          'mode': 'relative',
          'label_x': (ospwWidgets[i].channel_number - 1)*channelWidth,
          'label_y': ospwWidgets[i].top + marginTop,
          'label_text': ospwWidgets[i].name

        }
        break;

      }

    } else {
      osc_string = '/ospw/' + ospwWidgets[i].name;
      var widget =
      {
        'type': 'dial',
        'name': osc_string,
        'x': i*channelWidth + margin,
        'y': margin,
        'size': [dialSize.width, dialSize.height],
        'min':0,
        'max':1,
        'value':0,
        'interaction': 'vertical',
        'mode': 'relative',
        'label_text': ospwWidgets[i].name

      }
    }

    mixerWidgets[i] = widget;
  }
}

function prepareInterfaceBinaural() {
  for (let i = 0; i < binauralWidgetCount; i++) {
    let tempPointArray = [];
    for (let j = 0; j < listenersPerWidget; j++) {
      tempPointArray[j] = {
        distance: 1.5,
        angle: j * 45,
        label: j,
        colorIndex: j
      };
		}
    binauralWidgets[i] = tempPointArray;
  }
}

function prepareInterfaceMisc(socket) {
  // clear old miscWidgets
  miscWidgets = [];

  console.log('listing results of parsing');
  console.log(ospwWidgets);

  for (var i = 0; i < ospwWidgets.length; i++) {

    let osc_string = '/ospw/' + ospwWidgets[i].name;

    var widget = {
      'type': ospwWidgets[i].interface_type,
      'name': osc_string,
      'x': ospwWidgets[i].x * cellSize + margin,
      'y': ospwWidgets[i].y * cellSize + margin,
      'size': [defaultSize.width, defaultSize.height],
      'min': 0,
      'max': 1,
      'value':  ospwWidgets[i].init_value,
      // 'interaction': 'vertical',
      // 'mode': 'relative',
      'label_x': ospwWidgets[i].x * cellSize,
      'label_y': ospwWidgets[i].y * cellSize,
      'label_text': ospwWidgets[i].name
    }

    switch (ospwWidgets[i].interface_type) {
      case 'button':
        break;
      case 'dial':
        widget.interaction = 'vertical';
        widget.mode= 'relative';
        break;
      case 'number':
        break;
      case 'hslider':
        widget.type = 'slider';
        widget.size = [sliderLength, defaultSize.height];
        break;
      case 'vslider':
        widget.type = 'slider';
        widget.size = [defaultSize.width, sliderLength];
        break;
      case 'toggle':
        break;
    }
    miscWidgets[i] = widget;
  }

  console.log('listing miscWidgets');
  console.log(miscWidgets);


  socket.emit('reload');
  socket.broadcast.emit('reload');
}

// update the local variables for the generation of the interfaces of new clients
function updateValueMixer(name, value) {
  console.log(name);
  for (var i = 0; i < mixerWidgets.length; i++) {
    if (mixerWidgets[i].name === name) {
      mixerWidgets[i].value = value;
    }
  }
}
function updateValueBinaural(widgetIndex, pointIndex, angle, distance) {
    binauralWidgets[widgetIndex][pointIndex].angle = angle;
    binauralWidgets[widgetIndex][pointIndex].distance = distance;

    console.log(binauralWidgets[widgetIndex][pointIndex]);
}
function updateValueMisc(name, value) {
  console.log(name);
  for (var i = 0; i < miscWidgets.length; i++) {
    if (miscWidgets[i].name === name) {
      miscWidgets[i].value = value;
    }
  }
}


// when the client connects to the ospw (ospw.local:8000), window.onload is called in index.html
// there it sends "socket.emit('renderInterface')" to the server
// the server then evaluates what to send back, depending on internal variables

io.sockets.on('connection', function (socket) {

  socket.on('renderInterface', function(data) {
    if (!patchLoaded) {
      if (onMainPage) {
        socket.emit('createMain');
        console.log('Created the start page!');
      } else {
        // on misc page

        readMiscFolder(true, socket);

      }

    } else {
      switch (loadedPatchIndex) {
        case 0:
          socket.emit('createMixer', mixerWidgets, true, channelCount);
          break;
        case 1:
          socket.emit('createBinaural', binauralWidgets, binauralWidgetCount, listenersPerWidget);
          break;
        case 2:
          patchLoaded = false;
          socket.emit('createMain');
          console.log('now create reverb ... not implemented yet');
          break;
        case 3:
          socket.emit('createMiscPatch', miscWidgets, selectedMiscPatch);
          break;
      }
    }
  });


  socket.on('loadPatch', function(pdPatchIndex) {
    console.log("patch to load: " + pdPatchIndex);
    patchLoaded = true;
    loadedPatchIndex = pdPatchIndex;

    socket.emit('reload');
    socket.broadcast.emit('reload');
  });
  socket.on('loadMiscSite', function(pdMiscPatchIndex) {
    onMainPage = false;
    socket.emit('reload');
    socket.broadcast.emit('reload');
  });
  socket.on('loadMiscPatch', function(pdMiscPatchIndex) {
    // // if the patch is not the last one that was selected, the file gets parsed again
    // if (miscPatches[pdMiscPatchIndex] != selectedMiscPatch) {
      selectedMiscPatch = miscPatches[pdMiscPatchIndex];
      console.log("custom patch to load: " + selectedMiscPatch);


      patchLoaded = true;
      loadedPatchIndex = 3; // misc patch index

      pdPatchToParse = 'misc/' + selectedMiscPatch;
      parsePatch(false, socket); // patchIsMixer argument is false

    // } else {
    //   patchLoaded = true;
    //   loadedPatchIndex = 3; // misc patch index
    //
    //   socket.emit('reload');
    //   socket.broadcast.emit('reload');
    // }

  });
  socket.on('unloadPatch', function() {
    onMainPage = true;
    patchLoaded = false;

    socket.emit('reload');
    socket.broadcast.emit('reload');
  });


  socket.on('nx_mixer', function(data)
  {
    console.log(data);
    oscClient.send(data.oscName, data.value);
    updateValueMixer(data.oscName, data.value);
    socket.broadcast.emit('updateValueMixer', data.oscName, data.value);
    console.log(data.oscName, data.value);
  });
  socket.on('nx_binaural', function(data)
  {
    let widgetIndex = data.oscName;
    let pointIndex = data.value.pointIndex;
    let angle = data.value.angle;
    let distance =  data.value.distance;
    updateValueBinaural(widgetIndex, pointIndex, angle, distance);
    oscClient.send('/widget' + widgetIndex + '_angle/node' + pointIndex, angle);
    oscClient.send('/widget' + widgetIndex + '_dist/node' + pointIndex, distance);
    socket.broadcast.emit('updateValueBinaural', data.oscName, data.value);

  });
  socket.on('nx_misc', function(data)
  {
    console.log(data);
    oscClient.send(data.oscName, data.value);
    updateValueMisc(data.oscName, data.value);
    socket.broadcast.emit('updateValueMixer', data.oscName, data.value);
    console.log(data.oscName, data.value);

  });
});

oscServer.on('message', function(oscMsg, rinfo) {
  console.log(oscMsg);

  var oscPath = oscMsg[0],
  args = oscMsg.slice(1, oscMsg.length);

  switch(oscPath) {

    // update a widgets property
    // e.g. /nexus/update mySlider 0.5
    case '/nexus/update':
    updateWidget.apply(this, args);
    break;

    // this message allows the osc client being sent data about widget
    // values to be changed
    case '/nexus/osc_client':
    oscClient.host = oscMsg[1];
    oscClient.port = oscMsg[2];

    console.log(
      'Now sending OSC data to: ' + oscMsg[1] + ':' + oscMsg[2]
    );
    break;
  }
});
