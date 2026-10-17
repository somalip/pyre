import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_COMMANDS, CATEGORIES, filterCommands } from './menu/commands.js';
import { renderMenuScreen } from './menu/render.js';
import type { MenuState } from './menu/types.js';

describe('TUI Command Center & Tool Navigator', () => {
  it('should define a comprehensive catalog of Pyre commands', () => {
    assert.ok(ALL_COMMANDS.length >= 30, `Expected at least 30 commands, got ${ALL_COMMANDS.length}`);
    const ids = ALL_COMMANDS.map((c) => c.id);
    assert.ok(ids.includes('live'));
    assert.ok(ids.includes('check'));
    assert.ok(ids.includes('doctor'));
    assert.ok(ids.includes('smart'));
    assert.ok(ids.includes('anomalies'));
    assert.ok(ids.includes('benchmark'));
    assert.ok(ids.includes('optimize'));
    assert.ok(ids.includes('brew'));
    assert.ok(ids.includes('netusage'));
    assert.ok(ids.includes('ui'));
    assert.ok(ids.includes('web'));
  });

  it('should categorize every command into a valid category', () => {
    const validCatIds = CATEGORIES.map((c) => c.id);
    for (const cmd of ALL_COMMANDS) {
      assert.ok(
        validCatIds.includes(cmd.category),
        `Command ${cmd.id} has invalid category: ${cmd.category}`
      );
      assert.ok(cmd.name.length > 0);
      assert.ok(cmd.cli.startsWith('pyre '));
      assert.ok(cmd.description.length > 0);
      assert.ok(Array.isArray(cmd.tags));
      assert.ok(cmd.tags.length > 0);
    }
  });

  it('should filter commands by category', () => {
    const healthCmds = filterCommands(ALL_COMMANDS, 'health', '');
    assert.ok(healthCmds.length >= 4);
    assert.ok(healthCmds.some((c) => c.id === 'doctor'));
    assert.ok(healthCmds.some((c) => c.id === 'check'));
    assert.ok(healthCmds.some((c) => c.id === 'smart'));
    assert.ok(healthCmds.every((c) => c.category === 'health'));

    const perfCmds = filterCommands(ALL_COMMANDS, 'performance', '');
    assert.ok(perfCmds.some((c) => c.id === 'benchmark'));
    assert.ok(perfCmds.some((c) => c.id === 'stress'));
  });

  it('should fuzzy search commands by name, tag, or description', () => {
    // Search by exact name
    const docResults = filterCommands(ALL_COMMANDS, 'all', 'doctor');
    assert.strictEqual(docResults[0].id, 'doctor');

    // Search by tag
    const nvmeResults = filterCommands(ALL_COMMANDS, 'all', 'nvme');
    assert.ok(nvmeResults.some((c) => c.id === 'smart'));

    // Search by keyword in description
    const idleResults = filterCommands(ALL_COMMANDS, 'all', 'idle');
    assert.ok(idleResults.some((c) => c.id === 'optimize'));
  });

  it('should render menu screen without crashing', () => {
    const state: MenuState = {
      category: 'all',
      categoryIndex: 0,
      searchQuery: '',
      selectedIndex: 0,
      scrollOffset: 0,
      inputMode: 'search',
      argPromptValue: '',
      activeCommand: null,
      statusMessage: '',
      termWidth: 100,
      termHeight: 30,
      theme: 'default',
    };

    const rendered = renderMenuScreen(state, ALL_COMMANDS);
    assert.ok(typeof rendered === 'string');
    assert.ok(rendered.includes('Command Center'));
    assert.ok(rendered.includes('Search:'));
    assert.ok(rendered.includes('pyre live'));
    assert.strictEqual(/[\u{1F300}-\u{1FAFF}]/u.test(rendered), false, 'Menu rendered screen should not contain emojis');
  });

  it('should render argument prompt modal when inputMode is prompt-args', () => {
    const benchCmd = ALL_COMMANDS.find((c) => c.id === 'bench')!;
    const state: MenuState = {
      category: 'performance',
      categoryIndex: 3,
      searchQuery: '',
      selectedIndex: 0,
      scrollOffset: 0,
      inputMode: 'prompt-args',
      argPromptValue: 'npm test',
      activeCommand: benchCmd,
      statusMessage: '',
      termWidth: 100,
      termHeight: 30,
      theme: 'default',
    };

    const rendered = renderMenuScreen(state, [benchCmd]);
    assert.ok(rendered.includes('Execute:'));
    assert.ok(rendered.includes('npm test'));
  });
});
