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

    // Toggle container visibility without destroying DOM to eliminate flashes
    for (const [routeId, container] of this.containers.entries()) {
      container.hidden = routeId !== id;
    }

    let targetContainer = this.containers.get(id);
    if (!targetContainer) {
      targetContainer = document.createElement("div");
      targetContainer.className = `page-container page-container--${id}`;
      targetContainer.dataset.routeId = id;
      this.containers.set(id, targetContainer);
      this.host.append(targetContainer);
      await route.render(targetContainer);
    } else {
      targetContainer.hidden = false;
      targetContainer.dispatchEvent(new CustomEvent("page:activated", { bubbles: true }));
    }
  }
}
