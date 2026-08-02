import type { AppSettings } from "../../shared/types";
import { uiText } from "./ru";
import { uiTextEn } from "./en";

export type UiLanguage = AppSettings["language"];
export type UiText = {
  [Group in keyof typeof uiText]: {
    [Key in keyof typeof uiText[Group]]: string;
  };
};

export function getUiText(language: UiLanguage | null | undefined): UiText {
  return language === "en" ? uiTextEn : uiText;
}
