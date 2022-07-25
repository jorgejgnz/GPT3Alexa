
const Alexa = require('ask-sdk-core');
const i18n = require('i18next');
const sprintf = require('i18next-sprintf-postprocessor');
const got = require('got');

/**
 * 
 * GLOBAL VARIABLES
 * 
 */

const OPENAI_SECRET_KEY='{YOUR_OPENAI_API_KEY}';
const OPENAI_URL = 'https://api.openai.com/v1/completions';

const languageStrings = {
    'en': {
        translation: {
            WELCOME_MSG: 'Welcome!',
            HELP_MSG: 'For taking an action say: I want to, followed by the action you want to take',
            GOODBYE_MSG: 'Goodbye!',
            REFLECTOR_MSG: 'You just triggered {{intent}}',
            FALLBACK_MSG: 'Sorry, I don\'t know about that. Please try again.',
            ERROR_MSG: 'Sorry, there was an error. Please try again.'
        }
    },
    'es': {
        translation: {
            WELCOME_MSG: 'Buenas!',
            HELP_MSG: 'Para tomar una acción di: elijo, seguido de la acción que desees tomar.',
            GOODBYE_MSG: 'Adiós!',
            REFLECTOR_MSG: 'Has invocado el intent {{intent}}',
            FALLBACK_MSG: 'Buf. Ni idea. Prueba otra cosa',
            ERROR_MSG: 'Ha habido un error. Prueba otra cosa.'
        }
    }
}

const maxActionLength = 120;

const initMsg = {
    'en': "You're walking along a trail but it's getting dark and you're getting cold.",
    'es': "Vas andando por un sendero pero está atardeciendo y empieza a hacer frío.",
}
        
const initPrompt = {
    'en':"Conversation in which a human chooses actions and an AI describes the consequences of those actions.\n" +
    "\nIA:You are returning home after exploring new routes through the forest. You find an exit off the road that leads to a trail that looks very interesting." +
    "\nHumano: follow the trail" +
    "\nIA: ",
    'es':"Conversación en la que un humano elige acciones y una IA describe las consecuencias de esas acciones.\n" +
    "\nIA:Vuelves a casa después de explorar nuevas rutas por el monte. Encuentras una salida del camino que lleva a un sendero que parece muy interesante." +
    "\nHumano: seguir por el sendero" +
    "\nIA: ",
}

const warningMsg = {
    'en': "I'm not allowed to say what happens next. Try a different action.",
    'es': "No se me permite decir lo que ocurre después. Prueba con otra acción.",
}

const toxicLabels = ['2']; // 0 - safe, 1 - sensitive, 2 - harmful

/**
 * 
 * FUNCTIONS
 * 
 */

async function OpenAI_AdventureRequest (prompt) {

    const params = {
        "model": "davinci", //"{YOUR_FINE_TUNED_MODEL_ID}",
        "prompt": prompt,
        "max_tokens": 120,
        "temperature": 0.7,
        "frequency_penalty": 0.5,
        "stop": ["Humano:","Human:","AI:","IA:"]
    };
    const headers = {
        'Authorization': `Bearer ${OPENAI_SECRET_KEY}`,
    };
    
    try {
        const response = await got.post(OPENAI_URL, { json: params, headers: headers }).json();
        const output = response.choices[0].text;
        return output;
    } catch (err) {
        console.log(err);
        return "Error: " + err;
    }
}

async function OpenAI_ContentFilter (content) {

    const params = {
        "model":"content-filter-alpha",
        "prompt": "<|endoftext|>"+content+"\n--\nLabel:",
        "temperature": 0,
        "max_tokens": 1,
        "top_p": 0,
        "logprobs":10
    };
    
    const headers = {
        'Authorization': `Bearer ${OPENAI_SECRET_KEY}`,
    };
    
    try {
        const response = await got.post(OPENAI_URL, { json: params, headers: headers }).json();
        
        let output_label = response["choices"][0]["text"]

        // This is the probability at which we evaluate that a "2" is likely real
        // vs. should be discarded as a false positive
        const toxic_threshold = -0.355
        
        if (output_label === "2"){
            // If the model returns "2", return its confidence in 2 or other output-labels
            const logprobs = response["choices"][0]["logprobs"]["top_logprobs"][0];
        
            // If the model is not sufficiently confident in "2",
            // choose the most probable of "0" or "1"
            // Guaranteed to have a confidence for 2 since this was the selected token.
            if (logprobs["2"] < toxic_threshold){

                const logprob_0 = get(logprobs, "0", null);
                const logprob_1 = get(logprobs, "1", null);
        
                // If both "0" and "1" have probabilities, set the output label
                // to whichever is most probable
                if (logprob_0 !== null && logprob_1 !== null){
                    if (logprob_0 >= logprob_1) output_label = "0";
                    else output_label = "1";
                }
                // If only one of them is found, set output label to that one
                else if (logprob_0 !== null) output_label = "0";
                else if (logprob_1 !== null) output_label = "1";
                // If neither "0" or "1" are available, stick with "2"
                // by leaving output_label unchanged.
            }
           
        }
        
        // if the most probable token is none of "0", "1", or "2"
        // this should be set as unsafe
        if (!(["0", "1", "2"].includes(output_label))) output_label = "2";
        
        return output_label
    } catch (err) {
        console.log(err);
        return "Error: " + err;
    }
}

function UpdateSessionChat(attributesManager, prefix, msg, suffix, latestMsg)
{
    let sessionAttributes = attributesManager.getSessionAttributes();
    
    if (prefix !== null && prefix !== undefined && prefix !== "") sessionAttributes.chat += prefix;  
    sessionAttributes.chat += msg;  
    if (suffix !== null && suffix !== undefined && suffix !== "") sessionAttributes.chat += suffix;
    if (latestMsg !== null && latestMsg !== undefined && latestMsg !== "" ) sessionAttributes.latestMsg = latestMsg;
    
    attributesManager.setSessionAttributes(sessionAttributes);
}

function ClampSentences(msg, maxSentences)
{
    let splitted_msg = msg.split(".");
    if (splitted_msg.length >= maxSentences + 1) return splitted_msg.slice(0, 2).join('.');
    else return msg;
}

function ClampString(msg, maxCharacters)
{
    return msg.length > maxCharacters ? msg.substring(0, maxCharacters) : msg;
}

function get(object, key, default_value) {
    var result = object[key];
    return (typeof result !== "undefined") ? result : default_value;
}

/**
 * 
 * HANDLERS
 * 
 */

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        
        const lang = handlerInput.requestEnvelope.request.locale.split('-')[0];
        UpdateSessionChat(handlerInput.attributesManager, "", initPrompt[lang] + initMsg[lang], "", initMsg[lang]);

        return handlerInput.responseBuilder
            .speak(initMsg[lang])
            .reprompt(requestAttributes.t('HELP_MSG'))
            .getResponse();
    }
};

const AdventureChoiceIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AdventureChoiceIntent';
    },
    async handle(handlerInput) {
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        
        const intent = handlerInput.requestEnvelope.request.intent;
        const action = ClampString(intent.slots.action.value, maxActionLength);
        
        const new_chat_section = "\nHumano: " + action + "\nIA:";
        const extended_chat = handlerInput.attributesManager.getSessionAttributes().chat + new_chat_section;
        let ai_response = await OpenAI_AdventureRequest(extended_chat);
        ai_response = ClampSentences(ai_response, 2);
        
        const toxicity_label = await OpenAI_ContentFilter(ai_response); // 0 - safe, 1 - sensitive, 2 - harmful

        if (toxicLabels.includes(toxicity_label))
        {
            const lang = handlerInput.requestEnvelope.request.locale.split('-')[0];
            
            return handlerInput.responseBuilder
                .speak(warningMsg[lang])
                .reprompt(requestAttributes.t('HELP_MSG'))
                .getResponse();
        }
        else
        {
            UpdateSessionChat(handlerInput.attributesManager, "", new_chat_section, "", null);
            UpdateSessionChat(handlerInput.attributesManager, "", ai_response, "", ai_response);
        
            return handlerInput.responseBuilder
                .speak(ai_response)
                .reprompt(requestAttributes.t('HELP_MSG'))
                .getResponse();
        }
    }
};

const RepeatIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'RepeatIntent';
    },
    async handle(handlerInput) {
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        return handlerInput.responseBuilder
            .speak(sessionAttributes.latestMsg)
            .reprompt(requestAttributes.t('HELP_MSG'))
            .getResponse();
    }
};


const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        return handlerInput.responseBuilder
            .speak(requestAttributes.t('HELP_MSG'))
            .reprompt(requestAttributes.t('HELP_MSG'))
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        return handlerInput.responseBuilder
            .speak(requestAttributes.t('GOODBYE_MSG'))
            .getResponse();
    }
};
/* *
 * FallbackIntent triggers when a customer says something that doesn’t map to any intents in your skill
 * It must also be defined in the language model (if the locale supports it)
 * This handler can be safely added but will be ingnored in locales that do not support it yet 
 * */
const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        return handlerInput.responseBuilder
            .speak(requestAttributes.t('FALLBACK_MSG'))
            .reprompt(requestAttributes.t('HELP_MSG'))
            .getResponse();
    }
};
/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open 
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not 
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs 
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};
/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents 
 * by defining them above, then also adding them to the request handler chain below 
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};
/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below 
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        const speakOutput = 'Sorry, I had trouble doing what you asked. Please try again.';
        console.log(`~~~~ Error handled: ${JSON.stringify(error)}`);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

/**
 * Interceptor de entrada
 */
const LoggingRequestInterceptor = {
    process(handlerInput) {
        console.log(`Incoming request: ${JSON.stringify(handlerInput.requestEnvelope.request)}`)
    }
}

/**
 * Interceptor de salida
 */
const LoggingResponseInterceptor = {
    process(handlerInput, response) {
        console.log(`Outgoing response: ${JSON.stringify(response)}`)
    }
}

/**
 * Interceptor de lenguaje a la entrada
 */
const LocalizationInterceptor = {
  process(handlerInput) {
    // Gets the locale from the request and initializes 
    // i18next.
    const localizationClient = i18n.use(sprintf).init({
      lng: handlerInput.requestEnvelope.request.locale,
      resources: languageStrings,
    });
    // Creates a localize function to support arguments.
    localizationClient.localize = function localize() {
      // gets arguments through and passes them to
      // i18next using sprintf to replace string placeholders
      // with arguments.
      const args = arguments;
      const values = [];
      for (let i = 1; i < args.length; i += 1) {
        values.push(args[i]);
      }
      const value = i18n.t(args[0], {
        returnObjects: true,
        postProcess: 'sprintf',
        sprintf: values,
      });

      // If an array is used then a random value is selected 
      if (Array.isArray(value)) {
        return value[Math.floor(Math.random() * value.length)];
      }
      return value;
    };
    // this gets the request attributes and save the localize function inside 
    // it to be used in a handler by calling requestAttributes.t(STRING_ID, [args...])
    const attributes = handlerInput.attributesManager.getRequestAttributes();
    attributes.t = function translate(...args) {
      return localizationClient.localize(...args);
    };
  },
};

/**
 * This handler acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom 
 * */
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        AdventureChoiceIntentHandler,
        RepeatIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .addRequestInterceptors(
        LoggingRequestInterceptor,
        LocalizationInterceptor)
    .addRequestInterceptors(
        LoggingResponseInterceptor)
    //.withCustomUserAgent('sample/hello-world/v1.2')
    .lambda();