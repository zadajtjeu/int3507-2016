'use strict';
const
    sendFunctions = require('./sendFunctions'),
    redisClient = require('../../caching/redisClient'),
    models = require('../../models');

module.exports = function receivedMessage(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;
    var metadata = message.metadata;

    if (metadata == "DEVELOPER_DEFINED_METADATA") {
        // chatbot's messages, not from real user
        return; // will not process this kind of message
    }

    console.log("Received message for user %d and page %d at %d with message:",
        senderID, recipientID, timeOfMessage);
    console.log(JSON.stringify(message));

    // Can not use metadata === 'MULTIPLE_CHOICES' here?
    // if (quickReply && metadata === 'MULTIPLE_CHOICES') {
    if (quickReply) {
        let payload = quickReply.payload;
        if (payload) {
            let action = payload.split('_')[0];

            // If action is 'Multiple choices'
            if (action === 'MC') {
                require('../fnMutipleChoices/handleQuickReplyAction')(senderID, payload);
            }
            // If there is a MC answer suggestion
            else if (action === 'MCSUGGESTION') {
                require('../fnMutipleChoices/handleSuggestionQuickReply')(senderID, payload, event);
            }
            else if (action === 'LINEXT') {
                require('../fnListening/sendListeningChallenge')(senderID);
            }
            else if (action === 'PM') {
                require('../fnUserSettings/handleNotificationSettingQuickReplyAction')(senderID, payload);
            }
            else if (action === 'REMIND') {
                let functionToBeFired = payload.split('?')[1];
                if (functionToBeFired === 'NW') {
                    require('../fnNewWords/sendNewWord')(senderID);
                } else if (functionToBeFired === 'MC') {
                    require('../fnMutipleChoices/sendQuestion')(senderID);
                } else if (functionToBeFired === 'LI') {
                    require('../fnListening/sendListeningChallenge')(senderID);
                }
            }
        }
    }

    else if (messageText) {
        // Process text message commands for persistent menu
        var lowerCaseAndRemovedUnicodeMessageText = removeVietnameseUnicodeCharacters(messageText.toLowerCase());
        var updateProfileSignals = ['ho so ca nhan', 'ho so', 'thong tin ca nhan'],
            notificationSettingSignals = ['cai dat thong bao', 'thong bao'],
            learningProgressSignals = ['tien trinh hoc tap', 'ket qua hoc tap'],
            sendFunctionalityTestingSignals = ['gioi thieu cac tinh nang', 'gioi thieu tinh nang'];
        if (updateProfileSignals.indexOf(lowerCaseAndRemovedUnicodeMessageText) != -1) {
            require('../fnUserSettings/updateProfile')(senderID);
        } else if (learningProgressSignals.indexOf(lowerCaseAndRemovedUnicodeMessageText) != -1) {
            require('../fnUserSettings/learningProgress')(senderID);
        } else if (notificationSettingSignals.indexOf(lowerCaseAndRemovedUnicodeMessageText) != -1) {
            require('../fnUserSettings/notificationSetting')(senderID);
        } else if (sendFunctionalityTestingSignals.indexOf(lowerCaseAndRemovedUnicodeMessageText) != -1) {
            require('../fnUserSettings/sendFunctionalityTesting')(senderID);
        } else {
            redisClient.hgetall(senderID, function (err, reply) {
                if (err) {
                    console.log(err);
                }
                else if (reply && reply.context === 'MC') {
                    require('../fnMutipleChoices/handleTextReplyAction')(senderID, messageText, event);
                }
                else if (reply && reply.context === 'LI') {
                    require('../fnListening/handleTextReplyAction')(senderID, messageText, event);
                }
                else if (reply && reply.context === 'TW') {
                    require('../fnTests/handleTextReplyAction')(senderID, messageText, event);
                }
                else {
                    // hard code the command to enter fnPronunciation
                    let
                        pronunciationIntentFlag = 0,
                        pronunciationIntentSignals = [
                            'speak', 'say', 'pronounce',
                            'đọc', 'nói', 'phát âm',
                            'doc', 'noi', 'phat am'
                        ];
                    for (let i = 0; i < pronunciationIntentSignals.length; i++) {
                        if (messageText.toLowerCase().indexOf(pronunciationIntentSignals[i]) != -1) {
                            pronunciationIntentFlag = pronunciationIntentSignals[i].length;
                            break;
                        }
                    }

                    var testIntentSignal = 'test';

                    if (pronunciationIntentFlag != 0) {
                        var speechContent = messageText.substring(pronunciationIntentFlag + 1, messageText.length);
                        require('../fnPronunciation/sendAudio')(senderID, speechContent);
                    }
                    // End of fnPronunciation
                    else if (messageText.toLowerCase().indexOf(testIntentSignal) != -1) {
                        // enter test functionality
                        require('../fnTests/sendNewWordTest')(senderID);
                    }
                    // End of fnTests
                    else {
                        require('../intentClassification/getIntentClassification')(messageText, function (err, response) {
                            // Save the new context to redis
                            if (!err && response && response.intentClass) {
                                redisClient.hmset(senderID, ["context", response.intentClass], function (err, res) {
                                    if (err) {
                                        console.log("Redis error: ", err);
                                    }
                                    else {
                                        console.log(res);
                                    }
                                });
                            }

                            if (err) {
                                require('../sendErrorMessage')(senderID);
                            }
                            else if (response && response.intentClass === 'MC') {
                                require('../fnMutipleChoices/sendQuestion')(senderID);
                            }
                            else if (response && response.intentClass === 'NW') {
                                require('../fnNewWords/sendNewWord')(senderID);
                            }
                            else if (response && response.intentClass === 'LI') {
                                require('../fnListening/sendListeningChallenge')(senderID);
                            }
                            else if (response && response.intentClass === 'CO') {
                                require('../fnConversations/sendNormalMessage')(senderID, response.botResponse);
                            }
                            else {
                                require('./sendFunctions/sendTextMessage')(senderID, response.intentClass, function (err) {
                                    console.log("Message sent!");
                                });
                            }
                        });
                    }
                }
            });
        }
    }
    else if (messageAttachments) {
        sendFunctions.sendTextMessage(senderID, "Xin lỗi, hiện tại mình chỉ xử lý tin nhắn văn bản.");
    }
};

var removeVietnameseUnicodeCharacters = function(str) {
    str = str.toLowerCase();
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g,"a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g,"e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g,"i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g,"o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g,"u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g,"y");
    str = str.replace(/đ/g,"d");
    return str;
}