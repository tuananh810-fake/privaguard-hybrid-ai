declare namespace chrome {
  namespace runtime {
    const onInstalled: { addListener(cb: () => void): void };
    const onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
    function sendMessage(message: unknown, callback?: (response?: any) => void): void;
    function getURL(path: string): string;
    function getContexts(filter: { contextTypes?: string[] }): Promise<Array<{ contextType: string; documentUrl?: string }>>;
  }
  namespace offscreen {
    function createDocument(params: {
      url: string;
      reasons: string[];
      justification: string;
    }): Promise<void>;
  }
  namespace storage {
    const local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    const onChanged: {
      addListener(
        cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void
      ): void;
    };
  }
}
