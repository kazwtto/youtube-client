// Launcher icons (SVGs imported directly from src/assets/icons/launcher/)
import backSvg from "../assets/icons/launcher/back.svg?raw";
import checkSvg from "../assets/icons/launcher/check.svg?raw";
import chevronSvg from "../assets/icons/launcher/chevron.svg?raw";
import clockSvg from "../assets/icons/launcher/clock.svg?raw";
import closeSvg from "../assets/icons/launcher/close.svg?raw";
import copySvg from "../assets/icons/launcher/copy.svg?raw";
import discordSvg from "../assets/icons/launcher/discord.svg?raw";
import extensionsSvg from "../assets/icons/launcher/extensions.svg?raw";
import folderSvg from "../assets/icons/launcher/folder.svg?raw";
import forwardSvg from "../assets/icons/launcher/forward.svg?raw";
import gridSvg from "../assets/icons/launcher/grid.svg?raw";
import historySvg from "../assets/icons/launcher/history.svg?raw";
import homeSvg from "../assets/icons/launcher/home.svg?raw";
import listSvg from "../assets/icons/launcher/list.svg?raw";
import maximizeSvg from "../assets/icons/launcher/maximize.svg?raw";
import minimizeSvg from "../assets/icons/launcher/minimize.svg?raw";
import moreSvg from "../assets/icons/launcher/more.svg?raw";
import paletteSvg from "../assets/icons/launcher/palette.svg?raw";
import pipScreenSvg from "../assets/icons/launcher/pip-screen.svg?raw";
import pipSvg from "../assets/icons/launcher/pip.svg?raw";
import playSvg from "../assets/icons/launcher/play.svg?raw";
import plusSvg from "../assets/icons/launcher/plus.svg?raw";
import reloadSvg from "../assets/icons/launcher/reload.svg?raw";
import restoreSvg from "../assets/icons/launcher/restore.svg?raw";
import searchSvg from "../assets/icons/launcher/search.svg?raw";
import settingsSvg from "../assets/icons/launcher/settings.svg?raw";
import trashSvg from "../assets/icons/launcher/trash.svg?raw";

// YouTube icons (SVGs imported directly from src/assets/icons/youtube/)
import ytAccountSvg from "../assets/icons/youtube/account.svg?raw";
import ytBrandSvg from "../assets/icons/youtube/brand.svg?raw";
import ytClearSvg from "../assets/icons/youtube/clear.svg?raw";
import ytGuideSvg from "../assets/icons/youtube/guide.svg?raw";
import ytHelpSvg from "../assets/icons/youtube/help.svg?raw";
import ytHistorySvg from "../assets/icons/youtube/history.svg?raw";
import ytLogoutSvg from "../assets/icons/youtube/logout.svg?raw";
import ytMoreSvg from "../assets/icons/youtube/more.svg?raw";
import ytPurchasesSvg from "../assets/icons/youtube/purchases.svg?raw";
import ytSearchSvg from "../assets/icons/youtube/search.svg?raw";
import ytShortcutsSvg from "../assets/icons/youtube/shortcuts.svg?raw";
import ytStudioSvg from "../assets/icons/youtube/studio.svg?raw";
import ytSwitchAccountSvg from "../assets/icons/youtube/switch-account.svg?raw";
import ytVoiceSvg from "../assets/icons/youtube/voice.svg?raw";
import ytYourDataSvg from "../assets/icons/youtube/your-data.svg?raw";

export type IconName =
  | "back"
  | "forward"
  | "reload"
  | "home"
  | "history"
  | "extensions"
  | "discord"
  | "settings"
  | "palette"
  | "minimize"
  | "maximize"
  | "restore"
  | "pip"
  | "close"
  | "chevron"
  | "check"
  | "trash"
  | "plus"
  | "folder"
  | "search"
  | "clock"
  | "play"
  | "more"
  | "list"
  | "grid"
  | "copy"
  | "pip-screen";

export type YoutubeIconName =
  | "brand"
  | "guide"
  | "search"
  | "voice"
  | "clear"
  | "account"
  | "more"
  | "history"
  | "studio"
  | "switch-account"
  | "logout"
  | "purchases"
  | "your-data"
  | "shortcuts"
  | "help";

const LAUNCHER_ICONS: Record<IconName, string> = {
  back: backSvg,
  forward: forwardSvg,
  reload: reloadSvg,
  home: homeSvg,
  history: historySvg,
  extensions: extensionsSvg,
  discord: discordSvg,
  settings: settingsSvg,
  palette: paletteSvg,
  minimize: minimizeSvg,
  maximize: maximizeSvg,
  restore: restoreSvg,
  pip: pipSvg,
  close: closeSvg,
  chevron: chevronSvg,
  check: checkSvg,
  trash: trashSvg,
  plus: plusSvg,
  folder: folderSvg,
  search: searchSvg,
  clock: clockSvg,
  play: playSvg,
  more: moreSvg,
  list: listSvg,
  grid: gridSvg,
  copy: copySvg,
  "pip-screen": pipScreenSvg,
};

const YOUTUBE_ICONS: Record<YoutubeIconName, string> = {
  brand: ytBrandSvg,
  guide: ytGuideSvg,
  search: ytSearchSvg,
  voice: ytVoiceSvg,
  clear: ytClearSvg,
  account: ytAccountSvg,
  more: ytMoreSvg,
  history: ytHistorySvg,
  studio: ytStudioSvg,
  "switch-account": ytSwitchAccountSvg,
  logout: ytLogoutSvg,
  purchases: ytPurchasesSvg,
  "your-data": ytYourDataSvg,
  shortcuts: ytShortcutsSvg,
  help: ytHelpSvg,
};

function applySvgAttributes(
  rawSvg: string,
  options?: { size?: number; className?: string; style?: string },
): string {
  let svg = rawSvg.trim();

  if (options?.className) {
    if (/class="[^"]*"/.test(svg)) {
      svg = svg.replace(/class="[^"]*"/, `class="${options.className}"`);
    } else {
      svg = svg.replace("<svg", `<svg class="${options.className}"`);
    }
  }

  if (options?.size !== undefined) {
    if (/width="[^"]*"/.test(svg)) {
      svg = svg.replace(/width="[^"]*"/, `width="${options.size}"`);
    } else {
      svg = svg.replace("<svg", `<svg width="${options.size}"`);
    }
    if (/height="[^"]*"/.test(svg)) {
      svg = svg.replace(/height="[^"]*"/, `height="${options.size}"`);
    } else {
      svg = svg.replace("<svg", `<svg height="${options.size}"`);
    }
  }

  if (options?.style) {
    if (/style="[^"]*"/.test(svg)) {
      svg = svg.replace(/style="[^"]*"/, `style="${options.style}"`);
    } else {
      svg = svg.replace("<svg", `<svg style="${options.style}"`);
    }
  }

  return svg;
}

/// Dedicated component helper for launcher vector icons.
export function icon(name: IconName, size = 16, className = "icon"): string {
  const raw = LAUNCHER_ICONS[name];
  if (!raw) {
    return "";
  }
  return applySvgAttributes(raw, { size, className });
}

/// Dedicated component helper for authentic YouTube masthead and menu icons.
export function ytIcon(
  name: YoutubeIconName,
  size = 20,
  className?: string,
  style?: string,
): string {
  const raw = YOUTUBE_ICONS[name];
  if (!raw) {
    return "";
  }
  return applySvgAttributes(raw, { size, className, style });
}
