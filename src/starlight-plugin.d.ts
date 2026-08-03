declare module '@astrojs/starlight/types' {
  import type { AstroIntegration } from 'astro';

  // ponytail: compile shim avoids loading Starlight's app-only virtual modules; packed consumer proves real type compatibility.
  export interface StarlightPlugin {
    name: string;
    hooks: {
      'config:setup'(context: {
        addIntegration(integration: AstroIntegration): void;
      }): void;
    };
  }
}
