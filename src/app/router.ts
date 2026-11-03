export type RouteId = "home" | "settings" | "history" | "extensions" | "rpc";

export interface RouteDefinition {
  id: RouteId;
  render: (host: HTMLElement) => void | Promise<void>;
}

export type RouteListener = (route: RouteDefinition) => void | Promise<void>;

export class Router {
  private readonly routes = new Map<RouteId, RouteDefinition>();
  private readonly containers = new Map<RouteId, HTMLElement>();
  private readonly listeners = new Set<RouteListener>();
  private current: RouteId = "home";

  constructor(private readonly host: HTMLElement) {}

  register(definition: RouteDefinition): this {
    this.routes.set(definition.id, definition);
    return this;
  }

  get definitions(): RouteDefinition[] {
    return [...this.routes.values()];
  }

  get currentId(): RouteId {
    return this.current;
  }

  onNavigate(listener: RouteListener): void {
    this.listeners.add(listener);
  }

  async navigate(id: RouteId): Promise<void> {
    const route = this.routes.get(id);
    if (!route) {
      return;
    }

    this.current = id;

    for (const listener of this.listeners) {
      await listener(route);
    }

    this.host.replaceChildren();
    await route.render(this.host);
  }
}
