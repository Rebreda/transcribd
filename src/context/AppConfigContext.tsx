import { createContext, useContext, useMemo, useState, type Dispatch, type SetStateAction } from "react";

type AppConfigContextValue = {
  baseUrl: string;
  setBaseUrl: Dispatch<SetStateAction<string>>;
  apiKey: string;
  setApiKey: Dispatch<SetStateAction<string>>;
  model: string;
  setModel: Dispatch<SetStateAction<string>>;
  isAlwaysOnEnabled: boolean;
  setIsAlwaysOnEnabled: Dispatch<SetStateAction<boolean>>;
  selectedMicId: string;
  setSelectedMicId: Dispatch<SetStateAction<string>>;
  llmEnabled: boolean;
  setLlmEnabled: Dispatch<SetStateAction<boolean>>;
  llmBaseUrl: string;
  setLlmBaseUrl: Dispatch<SetStateAction<string>>;
  llmModel: string;
  setLlmModel: Dispatch<SetStateAction<string>>;
  llmApiKey: string;
  setLlmApiKey: Dispatch<SetStateAction<string>>;
};

const AppConfigContext = createContext<AppConfigContextValue | null>(null);

export function AppConfigProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [baseUrl, setBaseUrl] = useState("http://localhost:13305/api/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("Whisper-Base");
  const [isAlwaysOnEnabled, setIsAlwaysOnEnabled] = useState(true);
  const [selectedMicId, setSelectedMicId] = useState("");

  const [llmEnabled, setLlmEnabled] = useState(true);
  const [llmBaseUrl, setLlmBaseUrl] = useState("http://localhost:13305/api/v1");
  const [llmModel, setLlmModel] = useState("gpt-4o-mini");
  const [llmApiKey, setLlmApiKey] = useState("");

  const value = useMemo<AppConfigContextValue>(
    () => ({
      baseUrl,
      setBaseUrl,
      apiKey,
      setApiKey,
      model,
      setModel,
      isAlwaysOnEnabled,
      setIsAlwaysOnEnabled,
      selectedMicId,
      setSelectedMicId,
      llmEnabled,
      setLlmEnabled,
      llmBaseUrl,
      setLlmBaseUrl,
      llmModel,
      setLlmModel,
      llmApiKey,
      setLlmApiKey,
    }),
    [baseUrl, apiKey, model, isAlwaysOnEnabled, selectedMicId, llmEnabled, llmBaseUrl, llmModel, llmApiKey],
  );

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfigContextValue {
  const value = useContext(AppConfigContext);
  if (!value) {
    throw new Error("useAppConfig must be used within AppConfigProvider");
  }
  return value;
}
