import { TeamsAdapter } from "@microsoft/teams-ai";
import config from "./config";

const adapter = new TeamsAdapter(config);

const onTurnErrorHandler = async (context, error) => {
  console.error(`\n [onTurnError] unhandled error: ${error}`);

  if (context.activity.type === "message") {
    await context.sendTraceActivity(
      "OnTurnError Trace",
      `${error}`,
      "https://www.botframework.com/schemas/error",
      "TurnError"
    );
    await context.sendActivity("The agent encountered an error or bug.");
    await context.sendActivity("To continue to run this agent, please fix the agent source code.");
  }
};

adapter.onTurnError = onTurnErrorHandler;

export default adapter;
