"use strict";

Promise = require("bluebird");
const debug = require("debug")("bot-express:skill");
const dialogflow = require("../service/dialogflow.js");
const parse = require("../service/parser");
const SKIP_INTENT_LIST = ["Default Fallback Intent", "Default Welcome Intent", "escalation", "human-response", "robot-response"];

module.exports = class SkillHumanResponse {

    constructor(){
        this.required_parameter = {
            user: {},
            question: {},
            answer: {
                message_to_confirm: {
                    type: "text",
                    text: "OK. Answer please."
                }
            },
            enable_learning: {
                message_to_confirm: {
                    type: "template",
                    altText: "Do you want chabot learn this question?",
                    template: {
                        type: "confirm",
                        text: "Do you want chabot learn this question?",
                        actions: [
                            {type:"message", label:"Yes", text:"Yes"},
                            {type:"message", label:"No", text:"No"}
                        ]
                    }
                },
                parser: (value, bot, event, context, resolve, reject) => {
                    return parse.by_nlu_with_list(context.sender_language, "yes_no", value, ["Yes","No"], resolve, reject);
                },
                reaction: (error, value, bot, event, context, resolve, reject) => {
                    if (error) return resolve();
                    if (value === "No") return resolve();

                    // Ask if admin wants to create new intent or add this question to existing intent as new expression.
                    bot.collect("is_new_intent");
                    return resolve();
                }
            }
        }

        this.optional_parameter = {
            is_new_intent: {
                message_to_confirm: {
                    type: "template",
                    altText: "Is this a new question or existing one?",
                    template: {
                        type: "buttons",
                        text: "Is this a new question or existing one?",
                        actions: [
                            {type:"message", label:"New", text:"New"},
                            {type:"message", label:"Existing", text:"Existing"},
                            {type:"message", label:"No idea", text:"No idea"}
                        ]
                    }
                },
                parser: (value, bot, event, context, resolve, reject) => {
                    return parse.by_nlu_with_list(context.sender_language, "is_new_intent", value, ["New","Existing","No idea"], resolve, reject);
                },
                reaction: (error, value, bot, event, context, resolve, reject) => {
                    if (error) return resolve();

                    if (value === "New"){
                        // Create new intent using question and add response using answer.
                        return dialogflow.add_intent(
                            context.confirmed.question,
                            "robot-response",
                            context.confirmed.question,
                            context.confirmed.answer
                        ).then((response) => {
                            bot.queue({
                                type: "text",
                                text: "OK. I will add this question as new one."
                            });
                            return resolve();
                        });
                    }

                    // Let admin select the intent to add new expression.
                    return this._collect_intent_id(bot, context).then((response) => {
                        return resolve();
                    });
                }
            },
            intent_id: {
                parser: (value, bot, event, context, resolve, reject) => {
                    if (Number(value) !== NaN && Number.isInteger(Number(value)) && Number(value) > 0){
                        if (Number(value) <= context.confirmed.intent_list.length){
                            // User selected existing intent.
                            return resolve(context.confirmed.intent_list[Number(value) - 1].id);
                        } else if (Number(value) === (context.confirmed.intent_list.length + 1)){
                            // User selected new intent.
                            return resolve(null);
                        }
                    }
                    // Invalid.
                    return reject();
                },
                reaction: (error, value, bot, event, context, resolve, reject) => {
                    if (error) resolve();

                    if (value === null){
                        // Admin select to create new intent.
                        return dialogflow.add_intent(
                            context.confirmed.question,
                            "robot-response",
                            context.confirmed.question,
                            context.confirmed.answer
                        ).then((response) => {
                            bot.queue({
                                type: "text",
                                text: "OK. I will add this question as new one."
                            });
                            return resolve();
                        });
                    } else {
                        // Admin select to add sentence to the intent.
                        return dialogflow.add_sentence(
                            value,
                            context.confirmed.question
                        ).then((response) => {
                            bot.queue({
                                type: "text",
                                text: "OK. I will add this question as an example sentence."
                            });
                            return resolve();
                        });
                    }
                }
            }
        }

        this.clear_context_on_finish = (process.env.BOT_EXPRESS_ENV === "test") ? false : true;
    }

    _collect_intent_id(bot, context){
        return dialogflow.get_intent_list()
        .then((all_intent_list) => {
            debug("We remove intents specified in SKIP_INTENT_LIST.");
            let intent_list = [];
            for (let intent of all_intent_list){
                if (!SKIP_INTENT_LIST.includes(intent.name)){
                    intent_list.push(intent);
                }
            }

            // Save intent list to context.
            context.confirmed.intent_list = intent_list;
            debug(`We have ${intent_list.length} intent(s).`);

            let message = {
                type: "text",
                text: "Please tell me the number of the question to add this sentence.\n"
            }
            let offset = 1;
            for (let intent of intent_list){
                message.text += `${offset} ${intent.name}\n`;
                offset++;
            }
            message.text += `${offset} New question`;
            bot.change_message_to_confirm("intent_id", message);
            bot.collect("intent_id");

            return;
        });
    }

    finish(bot, event, context, resolve, reject){
        // Promise List.
        let tasks = [];

        // ### Tasks Overview ###
        // -> Reply to administrator.
        // -> Send message to original user.

        // -> Reply to administrator.
        tasks.push(bot.reply({
            type: "text",
            text: "Sure. I will replay to the user with your answer."
        }));

        // -> Reply to original user.
        tasks.push(bot.send(context.confirmed.user.id, {
            type: "text",
            text: context.confirmed.answer
        }, context.confirmed.user.language));

        return Promise.all(tasks).then((response) => {
            return resolve();
        });
    }
};
