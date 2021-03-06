/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

var data = {
    "users" : [
        {
            "id" : "123",
            "allergies" : ["nuts", "fish"],
        }
    ],
    "events" : [
        {
            "id" : "123",
            "name" : "My Cat's Birthday Party",
            "page" : "http://google.com",
            "hostID" : "123",
            "totalAllergies" : ["nuts", "fish", "strawberries"],
            
        }
    ],
    'count' : 1000
};

const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

/*
 * Be sure to setup your config values before running this code. You can 
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 * Use your own validation token. Check that the token used in the Webhook 
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've 
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL. 
 * 
 */
app.get('/authorize', function(req, res) {
  var accountLinkingToken = req.query.account_linking_token;
  var redirectURI = req.query.redirect_uri;

  // Authorization Code should be generated per user by the developer. This will 
  // be passed to the Account Linking callback.
  var authCode = "1234567890";

  // Redirect users to this URI on successful login
  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess
  });
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the 
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger' 
  // plugin.
  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam, 
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message' 
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some 
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've 
 * created. If we receive a message with an attachment (image, video, audio), 
 * then we'll simply confirm that we've received the attachment.
 * 
 */
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", 
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", 
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);
      
    if(quickReplyPayload === "eventName"){
        sendTextMessage(senderID, "To set your event name, type \"set name {event code, new name}\"");
    }
    else if(quickReplyPayload === "eventPage"){
        sendTextMessage(senderID, "To link to an event page, type \"set page {event code, new link}\"");
    }
    else if(quickReplyPayload === "invite"){
        sendTextMessage(senderID, "To generate invitations to an event, type \"invite {event code}\"");
    }
    else if(quickReplyPayload === "allergy info"){
        sendTextMessage(senderID, "To view guest allergies for an event, type \"allergy info {event code}\"");
    }
    else if(quickReplyPayload === "delete"){
        sendTextMessage(senderID, "To delete an event (must be host), type \"delete {event code}\"");
    }

    //sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (messageText) {
      
    messageText = messageText.toLowerCase();

    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
    
    if (messageText.substring(0,4) === "join"){
        console.log("Join event");
        var eventID = messageText.substring(5);
        var text = joinEvent(senderID, eventID);
        sendTextMessage(senderID, text);
    }
    else if (messageText.substring(0,13) === "set allergies"){
        console.log("Setting allergies");
        var text = setAllergies(senderID, messageText);
        sendTextMessage(senderID, text);
    }
    else if (messageText.substring(0,4) === "edit"){
        console.log("Edit event");
        eventSetup(senderID, messageText.substring(5));
    }
    else if (messageText.substring(0,12) === "allergy info"){
        console.log("Allergy info for event");
        var text = allergyInfo(senderID, messageText);
        sendTextMessage(senderID, text);
    }
    else if (messageText.substring(0, 8) === "set name"){
        console.log("Naming event");
        var text = setEventName(senderID, messageText.substring(9));
        sendTextMessage(senderID, text);
    }
    else if (messageText.substring(0, 8) === "set page"){
        console.log("Linking event");
        var text = setEventPage(senderID, messageText.substring(9));
        sendTextMessage(senderID, text);
    }
    else if (messageText.substring(0, 6) === "invite"){
        console.log("Inviting");
        var text = genInvite(senderID, messageText.substring(7));
        sendTextMessage(senderID, text);
    }
    else if (messageText.substring(0, 6) === "delete"){
        console.log("Deleting event");
        var text = deleteEvent(senderID, messageText.substring(7));
        sendTextMessage(senderID, text);
    }
    else{
        switch (messageText) {

          case 'hi':
            sendTextMessage(senderID, 'oh hi');
            break;
          case 'button':
            sendButtonMessage(senderID);
            break;

          case 'generic':
            sendGenericMessage(senderID);
            break;

          case 'quick reply':
            sendQuickReply(senderID);
            break;

          case 'host':
            eventSetup(senderID, null);
            break;

          case 'help':
            var text = "To host an event, type \"host\" | To join an event, type \"join {event id}\" | To set your allergies, type \"set allergies: {allergies separated by commas}\" | For more help, type \"help 2\""; 
            sendTextMessage(senderID, text);
            break;
                
          case 'help 2':
            var text = "To edit an event (must be host), type \"edit {event code}\" | To see the allergy information for an event, type \"allergy info {event id}\" | To wipe your account, type \"game over\""; 
            sendTextMessage(senderID, text);
            break;

          case 'game over':
            var text = deleteUser(senderID);
            sendTextMessage(senderID, text);
            break;

          case 'debug':
            var text = JSON.stringify(data);
            sendTextMessage(senderID, text);
            break;

          default:
            sendTextMessage(senderID, "Didn't get that. Type \"help\" for commands.");
        }
    }
  }
}

function findUser(senderID){
    for(var i = 0; i < data.users.length; i++){
        if(data.users[i].id===senderID){
            return data.users[i];
        }
    }
    return null;
}
function findEvent(eventID){
    for(var i = 0; i < data.events.length; i++){
        if(data.events[i].id===eventID){
            return data.events[i];
        }
    }
    return null;
}

function setAllergies(senderID, text){
    try {
        var allergies = text.substring(14);
        allergies = allergies.split(",");
        var user = findUser(senderID);
        if(user === null){
            user = {"id":senderID, "allergies":allergies};
            data.users.push(user);
        }
        else{
            user.allergies = allergies;
        }
        return "Allergies set.";
    }
    catch(e){
        console.log("Janky input");
        console.log(e);
    }
    return "Something went wrong.";
}

function deleteUser(senderID){
    for(var i = 0; i < data.users.length; i++){
        if(data.users[i].id===senderID){
            data.users.splice(i, 1);
            break;
        }
    }
    return "Your information has been removed.";
}

function joinEvent(senderID, eventID){
    try{
        var user = findUser(senderID)
        var event = findEvent(eventID);
        if(event !== null && user === null){
            return "Joined.";
        }
        else if(event !== null && user !== null){
            for(var i = 0; i < user.allergies.length; i++){
                var notThere = true;
                if(event.totalAllergies !== null && event.totalAllergies !== undefined){
                    for(var i2 = 0; i2 < event.totalAllergies.length; i2++){
                        if(event.totalAllergies[i2] === user.allergies[i]){
                            notThere = false;
                            break;
                        }
                    }
                }
                else{
                    event.totalAllergies = user.allergies;
                }
                if(notThere){
                    event.totalAllergies.push(user.allergies[i]);
                }
            }
            return "Joined.";
        }
        else{
            return "Event didn't exist :(";
        }
    }
    catch(e){
        console.log(e);
    }
    return "Something went wrong.";
}

function allergyInfo(senderID, text){
    try{
        console.log(text);
        var eventID = text.substring(13);
        var event = findEvent(eventID);
        if(event !== null){
            if(event.totalAllergies !== null && event.totalAllergies !== undefined){
                return event.totalAllergies.join(" ");
            }
            else{
                return "No one has allergies at this event.";
            }
        }
        else{
            return "Event doesn't exist :(";
        }
    }
    catch(e){
        console.log(e);
    }
    return "Something went wrong.";
}

function eventSetup(senderID, eventID){
    console.log(eventID);
    if(eventID === null){
        eventID = String(data.count);
        data.events.push({id : eventID, hostID: senderID});
        joinEvent(senderID, eventID);
        data.count++;
    }
    sendQuickReply(senderID, eventID);
}

function setEventName(senderID, text){
    return setEventItem(senderID, text, "name");
}

function setEventPage(senderID, text){
    return setEventItem(senderID, text, "page");
}

function setEventItem(senderID, text, item){
    try{
        var eventData = text.split(", ");
        console.log(eventData);
        var eventID = eventData[0];
        var eventItem = eventData[1];

        var event = findEvent(eventID);
        
        
        if(senderID === event.hostID){
            if (event !== null){
                event[item] = eventItem;
                return "Event updated."
            }
            return "Is there a comma between id and the item?\nEvent not found :(";
        }
        else{
            return "You're not a host of this event";
        }
    }
    catch(e){
        console.log(e);
    }
    return "Something went wrong.";
}

function genInvite(senderID, eventID){
    try{
        var msg = "";
        var event = findEvent(eventID);
        if(event !== null){
            if(event.name !== undefined){
                msg += "Come to " + event.name + ". ";
            }
            if(event.page !== undefined){
                msg += "Here's the event page: " + event.page + ". ";
            }
            msg += "If you have allergies, go to the Allergy Albert Facebook page, and type \"join " + event.id +"\""
            return msg;    
        }
    }
    catch(e){
        console.log(e);
    }
    return "Something went wrong";
}

function deleteEvent(senderID, eventID){
    try{
        for(var i = 0; i < data.events.length; i++){
            if(eventID === data.events[i].id){
                data.events.splice(i, 1);
                break;
            }
        }
    }
    catch(e){
        console.log(e);
    }
    return "Something went wrong. Does that event exist?";
}


/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s", 
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback 
  // button for Structured Messages. 
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " + 
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to 
  // let them know it was successful
 
  //sendTextMessage(senderID, "Postback called");
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons:[{
            type: "web_url",
            url: "https://www.oculus.com/en-us/rift/",
            title: "Open Web URL"
          }, {
            type: "postback",
            title: "Trigger Postback",
            payload: "DEVELOPER_DEFINED_PAYLOAD"
          }, {
            type: "phone_number",
            title: "Call Phone Number",
            payload: "+16505551234"
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",               
            image_url: SERVER_URL + "/assets/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",               
            image_url: SERVER_URL + "/assets/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, eventID) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "Your eventID is " + eventID + ". What would you like to do?",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Name it.",
          "payload":"eventName"
        },
        {
          "content_type":"text",
          "title":"Link page.",
          "payload":"eventPage"
        },
        {
          "content_type":"text",
          "title":"Invite people.",
          "payload":"invite"
        },
        {
          "content_type":"text",
          "title":"View allergies.",
          "payload":"allergy info"
        },
        {
          "content_type":"text",
          "title":"Delete it.",
          "payload":"delete"
        }
      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });  
}

function createGreeting(data){
    request({
        uri: 'https://graph.facebook.com/v2.6/me/thread_settings',
        qs: { access_token: PAGE_ACCESS_TOKEN },
        method: 'POST',
        json: data
    }, function(error, response, body){
        if(!error && response.statusCode == 200){
            console.log("Set greeting successfully");
        }
        else{
            console.error("Failed calling Thread Reference API", response.statusCode, response.statusMessage, body.error);
        }
    });
}

function setGreetingText(){
    var greetingData = {
        setting_type: "greeting",
        greeting:{
            text: "Howdy {{user_first_name}}. If you have allergies, type \"set allergies:\" followed by your comma-separated allergies (i.e. \"set allergies: nuts, fish, homework\")"
        }
    };
    createGreeting(greetingData);
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
    setGreetingText();
});

module.exports = app;

