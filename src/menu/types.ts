/**
 * Type definitions for Pyre's interactive TUI Command Center.
 */

export type CommandCategory =
  | 'all'
  | 'dashboards'
  | 'health'
  | 'performance'
  | 'maintenance'
  | 'network'
  | 'config';

export interface CategoryInfo {
  id: CommandCategory;
  name: string;
  icon: string;
  badge: string;
}

export interface CommandFlag {
  flag: string;
  desc: string;
  example?: string;
}

export interface CommandDefinition {
  id: string;
  name: string;
  cli: string;
  category: CommandCategory;
  badge: string;
  description: string;
  detailedHelp: string;
  flags?: CommandFlag[];
  examples?: string[];
  tags: string[];
  /** Whether the command runs interactively (replaces screen) or one-shot */
  interactive?: boolean;
  /** Whether the command requires argument input before running */
  requiresArgs?: {
    prompt: string;
    placeholder: string;
    defaultVal?: string;
  };
}

export type MenuInputMode = 'search' | 'prompt-args' | 'edit-cmd' | 'help';

export interface MenuState {
  category: CommandCategory;
  categoryIndex: number;
  searchQuery: string;
  selectedIndex: number;
  scrollOffset: number;
  inputMode: MenuInputMode;
  argPromptValue: string;
  activeCommand: CommandDefinition | null;
  statusMessage: string;
  termWidth: number;
  termHeight: number;
  theme: string;
}
