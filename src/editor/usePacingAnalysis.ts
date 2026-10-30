import { useEffect, useState } from "react";
import type { AudioAnalysis, Suggestion } from "../pacing";

export function usePacingAnalysis(mediaPath?: string) {
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [includedSuggestions, setIncludedSuggestions] = useState<number[]>([]);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    setAnalysis(null);
    setSuggestions([]);
    setIncludedSuggestions([]);
  }, [mediaPath]);

  return {
    analysis,
    setAnalysis,
    suggestions,
    setSuggestions,
    includedSuggestions,
    setIncludedSuggestions,
    analyzing,
    setAnalyzing,
  };
}
