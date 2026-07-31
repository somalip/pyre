import readline from 'node:readline';
import chalk from 'chalk';
import { readConfig, writeConfig, CONFIG_FILE } from './state/config.js';
import fs from 'node:fs';

export async function runSetupWizardIfNeeded(skipWizardFlag?: boolean): Promise<void> {
  if (skipWizardFlag || process.env.PYRE_NO_WIZARD === '1' || !process.stdout.isTTY) {
    return;
  }

  if (fs.existsSync(CONFIG_FILE)) {
    return;
  }

  console.log(chalk.bold('\n  🔥 Welcome to pyre! First-run Setup Wizard\n'));
  console.log(chalk.dim('  This quick 3-question setup configures your defaults.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  try {
    // Question 1: Theme
    console.log(chalk.cyan('  1. Pick a default color theme:'));
    console.log(chalk.dim('     (1) default  (2) dracula  (3) cyberpunk  (4) monochrome  (5) nord  (6) gruvbox'));
    const themeAns = (await ask(chalk.yellow('     Choice [1-6] (default: 1): '))).trim();
    let theme = 'default';
    if (themeAns === '2') theme = 'dracula';
    else if (themeAns === '3') theme = 'cyberpunk';
    else if (themeAns === '4') theme = 'monochrome';
    else if (themeAns === '5') theme = 'nord';
    else if (themeAns === '6') theme = 'gruvbox';

    // Question 2: Notifications
    console.log(chalk.cyan('\n  2. Enable desktop notifications on system thermal/CPU alerts?'));
    const notifAns = (await ask(chalk.yellow('     Enable notifications? [Y/n]: '))).trim().toLowerCase();
    const notificationsEnabled = notifAns !== 'n';

    // Question 3: Powermetrics / Sudo explanation
    console.log(chalk.cyan('\n  3. Sudo / Powermetrics setup:'));
    console.log(chalk.dim('     pyre reads basic metrics sudolessly. For detailed per-core wattages,'));
    console.log(chalk.dim('     you can optionally grant passwordless sudo for powermetrics later.'));
    await ask(chalk.yellow('     Press Enter to finish setup... '));

    writeConfig({
      theme,
      notificationsEnabled,
    });

    console.log(chalk.green('\n  ✔ Preferences saved to ~/.config/pyre/config.json\n'));
  } catch {
    // fallback if interrupted
  } finally {
    rl.close();
  }
}
