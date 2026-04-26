import { createContext, useContext, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  DEFAULT_LLM_MODEL,
  DEFAULT_SERVER_BASE_URL,
  DEFAULT_WHISPER_MODEL,
} from "../lib/constants";
import {
  parseLlmInferenceOptions,
  parseRealtimeSessionOptions,
  parseTranscriptionRequestOptions,
  type LlmInferenceOptions,
  type RealtimeSessionOptions,
  type TranscriptionRequestOptions,
} from "../lib/apiSchemas";

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
  realtimeOptions: RealtimeSessionOptions;
  setRealtimeOptions: Dispatch<SetStateAction<RealtimeSessionOptions>>;
  transcriptionOptions: TranscriptionRequestOptions;
  setTranscriptionOptions: Dispatch<SetStateAction<TranscriptionRequestOptions>>;
  llmInferenceOptions: LlmInferenceOptions;
  setLlmInferenceOptions: Dispatch<SetStateAction<LlmInferenceOptions>>;
  showSuppressedRecords: boolean;
  setShowSuppressedRecords: Dispatch<SetStateAction<boolean>>;
};

const AppConfigContext = createContext<AppConfigContextValue | null>(null);

export function AppConfigProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_SERVER_BASE_URL);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_WHISPER_MODEL);
  const [isAlwaysOnEnabled, setIsAlwaysOnEnabled] = useState(true);
  const [selectedMicId, setSelectedMicId] = useState("");

  const [llmEnabled, setLlmEnabled] = useState(true);
  const [llmBaseUrl, setLlmBaseUrl] = useState(DEFAULT_SERVER_BASE_URL);
  const [llmModel, setLlmModel] = useState(DEFAULT_LLM_MODEL);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [realtimeOptions, setRealtimeOptions] = useState<RealtimeSessionOptions>(() => parseRealtimeSessionOptions({}));
  const [transcriptionOptions, setTranscriptionOptions] = useState<TranscriptionRequestOptions>(() => parseTranscriptionRequestOptions({}));
  const [llmInferenceOptions, setLlmInferenceOptions] = useState<LlmInferenceOptions>(() => parseLlmInferenceOptions({}));
  const [showSuppressedRecords, setShowSuppressedRecords] = useState(false);

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
      realtimeOptions,
      setRealtimeOptions,
      transcriptionOptions,
      setTranscriptionOptions,
      llmInferenceOptions,
      setLlmInferenceOptions,
      showSuppressedRecords,
      setShowSuppressedRecords,
    }),
    [
      baseUrl,
      apiKey,
      model,
      isAlwaysOnEnabled,
      selectedMicId,
      llmEnabled,
      llmBaseUrl,
      llmModel,
      llmApiKey,
      realtimeOptions,
      transcriptionOptions,
      llmInferenceOptions,
      showSuppressedRecords,
    ],
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
