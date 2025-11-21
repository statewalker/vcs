export interface ExampleConfig {
  name: string;
}

export function buildGreeting(config: ExampleConfig): string {
  return `Hello from core, ${config.name}!`;
}
