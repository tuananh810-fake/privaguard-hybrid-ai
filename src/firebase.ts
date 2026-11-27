import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getFirestore } from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getString } from 'firebase/remote-config';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAvwsoI0zTybrE4qM-tN8cJX2RAH7o_ZCA',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'buildhybridai-tuananh.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'buildhybridai-tuananh',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'buildhybridai-tuananh.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '442185224473',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:442185224473:web:4b62b10b0d4a109eb17588',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-S3ECNB4LZT',
};

const RECAPTCHA_SITE_KEY =
  import.meta.env.VITE_RECAPTCHA_SITE_KEY || '6Ldl-DQuAAAAAHzZNv-m4KHk_gX5xiSYk1wNQkT3';

// Enable App Check debug token on localhost if configured
if (typeof window !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  const savedDebug = localStorage.getItem('privaguard_appcheck_debug');
  const envDebug = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  if (envDebug) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = envDebug;
  } else if (savedDebug) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = savedDebug;
  } else {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
}

export const app = initializeApp(firebaseConfig);

export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

export const ai = getAI(app, { backend: new GoogleAIBackend() });
export const db = getFirestore(app);
export const remoteConfig = getRemoteConfig(app);

remoteConfig.settings.minimumFetchIntervalMillis = 60_000;
remoteConfig.defaultConfig = {
  default_inference_mode: 'PREFER_ON_DEVICE',
  cloud_model: 'gemini-2.5-flash',
  system_prompt_style: 'concise_executive',
};

export interface RemoteSettings {
  defaultInferenceMode: string;
  cloudModel: string;
  systemPromptStyle: string;
  loadedFromServer: boolean;
}

export async function loadRemoteSettings(): Promise<RemoteSettings> {
  try {
    const activated = await fetchAndActivate(remoteConfig);
    return {
      defaultInferenceMode: getString(remoteConfig, 'default_inference_mode') || 'PREFER_ON_DEVICE',
      cloudModel: getString(remoteConfig, 'cloud_model') || 'gemini-2.5-flash',
      systemPromptStyle: getString(remoteConfig, 'system_prompt_style') || 'concise_executive',
      loadedFromServer: activated,
    };
  } catch {
    return {
      defaultInferenceMode: 'PREFER_ON_DEVICE',
      cloudModel: 'gemini-2.5-flash',
      systemPromptStyle: 'concise_executive',
      loadedFromServer: false,
    };
  }
}
