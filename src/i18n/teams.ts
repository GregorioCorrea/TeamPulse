import { TurnContext } from "botbuilder";
import { ensureLocale, Locale } from "./index";

export function getContextLocale(context: TurnContext, fallback?: string | null): Locale {
  const activityLocale = (context.activity && (context.activity.locale as string)) || undefined;
  const channelLocale = (context.activity && context.activity.channelData && (context.activity.channelData.locale as string)) || undefined;
  const selected = activityLocale || channelLocale || fallback;
  return ensureLocale(selected);
}
