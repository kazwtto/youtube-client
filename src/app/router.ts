export type RouteId = "home" | "settings" | "history" | "extensions" | "rpc";

export interface RouteDefinition {
  id: RouteId;
  render: (host: HTMLElement) => void | Promise<void>;
}

export type RouteListener = (route: RouteDefinition) => void | Promise<void>;

export class Router {
  private readonly routes = new Map<RouteId, RouteDefinition>();
  private readonly containers = new Map<RouteId, HTMLElement>();
  private readonly pendingRenders = new Map<RouteId, Promise<void>>();
  private readonly listeners = new Set<RouteListener>();
  private current: RouteId = "home";
  private navigation = 0;

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
    if (!route) return;

    const navigation = ++this.navigation;
    const changedRoute = id !== this.current;
    this.current = id;

    for (const listener of this.listeners) {
      await listener(route);
      if (navigation !== this.navigation) return;
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
      const rendering = Promise.resolve().then(() => route.render(targetContainer!)).then(() => undefined);
      this.pendingRenders.set(id, rendering);
      try {
        await rendering;
      } catch (error) {
        if (this.pendingRenders.get(id) === rendering) this.pendingRenders.delete(id);
        if (this.containers.get(id) === targetContainer) this.containers.delete(id);
        targetContainer.remove();
        throw error;
      }
      if (this.pendingRenders.get(id) === rendering) this.pendingRenders.delete(id);
      if (navigation !== this.navigation) {
        targetContainer.hidden = true;
        return;
      }
    } else {
      const rendering = this.pendingRenders.get(id);
      if (rendering) {
        await rendering;
        if (navigation !== this.navigation) return;
      }
      targetContainer.dispatchEvent(new CustomEvent("page:activated", { bubbles: true }));
    }

    targetContainer.hidden = false;
    if (id !== "home" && changedRoute) {
      targetContainer.classList.remove("page-container--enter");
      void targetContainer.offsetWidth;
      targetContainer.classList.add("page-container--enter");
    }
  }
}
