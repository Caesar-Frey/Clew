import {
  deviceSpeechLocale,
  hasOfflineLocale,
  normalizeLocale,
} from "../src/voice/locale";

describe("speech locale", () => {
  it("uses the phone language, with a region", () => {
    expect(deviceSpeechLocale("en-GB")).toBe("en-GB");
    expect(deviceSpeechLocale("de_de")).toBe("de-DE");
    expect(deviceSpeechLocale("fr")).toBe("fr-FR");
    expect(deviceSpeechLocale("en")).toBe("en-US");
    expect(deviceSpeechLocale(undefined)).toBe("en-US");
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh-Hans-CN");
  });

  it("checks offline support for that exact locale", () => {
    expect(hasOfflineLocale("en-GB", ["en_US", "en-gb"])).toBe(true);
    expect(hasOfflineLocale("en-GB", ["en-US"])).toBe(false);
    expect(hasOfflineLocale("de-DE", [])).toBe(false);
  });
});
