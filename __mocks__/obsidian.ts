/**
 * Vitest stub for the `obsidian` package.
 *
 * The real `obsidian` npm package ships only TypeScript declarations
 * (`"main": ""`), so Vite cannot resolve a runtime entry. Unit tests that
 * import modules transitively pulling `Modal`/`App` from `obsidian` need a
 * minimal runtime stub. Only the surface area exercised by wikilink-inspector
 * tests is provided; extend as needed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment */

export class Modal {
  app: any;
  titleEl: { setText: (_: string) => void };
  contentEl: {
    createEl: (...args: any[]) => any;
    createDiv: (...args: any[]) => any;
    empty: () => void;
  };

  constructor(app: any) {
    this.app = app;
    this.titleEl = { setText: () => {} };
    this.contentEl = {
      createEl: () => ({}),
      createDiv: () => ({
        createEl: () => ({ addEventListener: () => {} }),
      }),
      empty: () => {},
    };
  }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}
