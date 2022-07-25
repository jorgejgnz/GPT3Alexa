# Ramified Stories using GPT3 and Alexa

Alexa Skill that performs requests to OpenAI API to continue a story according to user's actions. It supports both English and Spanish.

A content filter is applied to the completions produced, eliminating potentially harmful AI responses, as recommended in [Open AI documentation](https://beta.openai.com/docs/models/content-filter).

The following fragment is an example of the output that can be obtained with this skill:

```

🤖 You're walking along a trail but it's getting dark and you're getting cold

👤 i want to keep walking along the trail

🤖 You keep walking along the trail. After a while you start to see lights ahead

👤 i want to check phone battery

🤖 You check the battery on your phone. The battery is low but you still have a little bit of charge left

👤 i will walk to towards the lights to see where they come from

🤖 You walk towards the lights. The lights seem to be coming from a cave

```

## Considerations

It is recommended to take actions that make sense and follow the plot of the story in order for the plot to maintain meaning.

Ordering long and detailed actions leads to long and detailed responses from the model.

It is recommended to use a model previously fine tuned with many samples of detailed actions and consequences.

After several interactions there are often inconsistencies in the story since the prompt only includes the message history.

## License

[MIT](LICENSE)