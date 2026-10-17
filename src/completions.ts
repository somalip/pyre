export function generateZshCompletions(): string {
  return `#compdef pyre

_pyre() {
    local -a commands
    commands=(
        'menu:Interactive TUI command center and tools navigator'
        'tui:Alias for menu'
        'launcher:Alias for menu'
        'playbook:Execute sequenced multi-step macro recipes'
        'flight:Forensic flight recorder black box'
        'run:Performance budgeting runner for CI/CD gates'
        'bench-git:Cross-branch git performance differ'
        'statusline:Headless terminal statusline string'
        'inspect:Process deep-dive inspector'
        'containers:Container and micro-VM telemetry'
        'live:Start interactive live monitoring dashboard'
        'info:Display static system overview'
        'doctor:Run system permissions and diagnostic checks'
        'web:Launch web dashboard server'
        'ui:Launch Activity Monitor UI window'
        'launch:Launch Activity Monitor UI window'
        'config:Show or reset configuration options'
        'p2p:P2P streaming server or client'
        'ssh:Stream metrics over SSH'
        'completions:Generate shell completion scripts'
        'optimize:Mac optimizer (quit idle apps, memory, caches, trash, startup, dns)'
        'sleep-audit:Standby & sleep battery drain diagnostics'
        'sweep:Developer & project build cruft sweeper (node_modules, target, etc.)'
        'awake:Guardrailed keep-awake utility with thermal and battery failsafes'
        'net-audit:Outbound network and privacy flow inspector (cleartext HTTP, sockets)'
        'focus:Turbo / Focus performance shield (QoS and background process tamer)'
        'ha:Home Assistant MQTT auto-discovery and telemetry bridge'
        'ports:Listening port, socket and local dev server manager'
        'gpu:Deep GPU, Unified Memory, ANE and AI/LLM workload inspector'
        'leaks:Real-time process memory leak and monotonic growth detector'
        'zombies:Zombie, stuck I/O, spinlock and stale dev orphan hunter'
    )

    _arguments -s \\
        '(-j --json)'{-j,--json}'[Output snapshot as JSON]' \\
        '--html[Output snapshot as HTML]' \\
        '--md[Output snapshot as Markdown]' \\
        '(-c --csv)'{-c,--csv}'[Output snapshot as CSV]' \\
        '(-t --tsv)'{-t,--tsv}'[Output snapshot as TSV]' \\
        '--detailed[Include detailed system info and sensor readings]' \\
        '--theme[Default theme]:theme:(default dracula cyberpunk monochrome nord gruvbox)' \\
        '--interval[Refresh interval in seconds]:seconds:' \\
        '--once[Show a single static snapshot]' \\
        '--out[Write snapshot output to file]:file:_files' \\
        '--export-dir[Directory for snapshot exports and logs]:directory:_files -/' \\
        '--log[Start continuous CSV logging]' \\
        '--tree[Show process tree view]' \\
        '--sort[Sort processes by]:key:(cpu mem pid user command state threads runtime)' \\
        '(-r --reverse)'{-r,--reverse}'[Reverse process sort order]' \\
        '--packets[Include packet monitor panel]' \\
        '--limit[Max processes to include]:count:' \\
        '--alert-cpu[CPU alert threshold pct]:pct:' \\
        '--alert-temp[CPU alert threshold temp C]:temp:' \\
        '--temp-unit[Temperature display unit]:unit:(c f)' \\
        '*::command:->command'

    case $state in
        command)
            _describe -t commands 'pyre command' commands
            ;;
    esac
}

_pyre "$@"
`;
}

export function generateBashCompletions(): string {
  return `# bash completion for pyre

_pyre_completions() {
    local cur prev opts commands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    commands="menu tui launcher playbook flight run bench-git statusline inspect containers ports gpu leaks zombies live info doctor web ui launch config p2p ssh bench completions optimize sleep-audit sweep awake net-audit focus ha"
    opts="--json --html --md --csv --tsv --detailed --theme --interval --once --out --export-dir --log --tree --sort --reverse -r --kill-port --samples --packets --limit --alert-cpu --alert-temp --temp-unit --idle --keep --yes --force --clean --empty --dry-run --auto-quit -m --menu -i --interactive --budget-cpu --budget-mem --budget-time --markdown --nice --format --min-battery --max-temp --until-done --while-network --inactive-days --exclude-dirty --targets --export-pf --export-hosts --webhook --suspend"

    case "${prev}" in
        --theme)
            COMPREPLY=( $(compgen -W "default dracula cyberpunk monochrome nord gruvbox" -- ${cur}) )
            return 0
            ;;
        --sort)
            COMPREPLY=( $(compgen -W "cpu mem pid user command state threads runtime" -- ${cur}) )
            return 0
            ;;
        --temp-unit)
            COMPREPLY=( $(compgen -W "c f" -- ${cur}) )
            return 0
            ;;
        config)
            COMPREPLY=( $(compgen -W "show reset" -- ${cur}) )
            return 0
            ;;
        p2p)
            COMPREPLY=( $(compgen -W "server connect" -- ${cur}) )
            return 0
            ;;
        optimize)
            COMPREPLY=( $(compgen -W "apps track memory caches trash startup dns protect unprotect help" -- ${cur}) )
            return 0
            ;;
        playbook)
            COMPREPLY=( $(compgen -W "run list audit clean triage bench" -- ${cur}) )
            return 0
            ;;
        flight)
            COMPREPLY=( $(compgen -W "dump status record" -- ${cur}) )
            return 0
            ;;
        statusline)
            COMPREPLY=( $(compgen -W "tmux starship json pango plain" -- ${cur}) )
            return 0
            ;;
        focus)
            COMPREPLY=( $(compgen -W "on off status" -- ${cur}) )
            return 0
            ;;
        ha)
            COMPREPLY=( $(compgen -W "config publish discovery state" -- ${cur}) )
            return 0
            ;;
    esac

    if [[ ${cur} == -* ]] ; then
        COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
        return 0
    fi

    COMPREPLY=( $(compgen -W "${commands}" -- ${cur}) )
}

complete -F _pyre_completions pyre
`;
}

export function generateFishCompletions(): string {
  return `# fish completion for pyre

complete -c pyre -n "__fish_use_subcommand" -a menu -d "Interactive TUI command center and tools navigator"
complete -c pyre -n "__fish_use_subcommand" -a tui -d "Alias for menu"
complete -c pyre -n "__fish_use_subcommand" -a launcher -d "Alias for menu"
complete -c pyre -n "__fish_use_subcommand" -a playbook -d "Execute sequenced multi-step macro recipes"
complete -c pyre -n "__fish_use_subcommand" -a flight -d "Forensic flight recorder black box"
complete -c pyre -n "__fish_use_subcommand" -a run -d "Performance budgeting runner for CI/CD gates"
complete -c pyre -n "__fish_use_subcommand" -a bench-git -d "Cross-branch git performance differ"
complete -c pyre -n "__fish_use_subcommand" -a statusline -d "Headless terminal statusline string"
complete -c pyre -n "__fish_use_subcommand" -a inspect -d "Process deep-dive inspector"
complete -c pyre -n "__fish_use_subcommand" -a containers -d "Container and micro-VM telemetry"
complete -c pyre -n "__fish_use_subcommand" -a ports -d "Listening port, socket and local dev server manager"
complete -c pyre -n "__fish_use_subcommand" -a gpu -d "Deep GPU, Unified Memory, ANE and AI/LLM workload inspector"
complete -c pyre -n "__fish_use_subcommand" -a leaks -d "Real-time process memory leak detector"
complete -c pyre -n "__fish_use_subcommand" -a zombies -d "Zombie, stuck I/O, spinlock and stale dev orphan hunter"
complete -c pyre -n "__fish_use_subcommand" -a live -d "Start interactive live monitoring dashboard"
complete -c pyre -n "__fish_use_subcommand" -a info -d "Display static system overview"
complete -c pyre -n "__fish_use_subcommand" -a doctor -d "Run system diagnostics"
complete -c pyre -n "__fish_use_subcommand" -a web -d "Launch web dashboard server"
complete -c pyre -n "__fish_use_subcommand" -a ui -d "Launch Activity Monitor UI window"
complete -c pyre -n "__fish_use_subcommand" -a launch -d "Launch Activity Monitor UI window"
complete -c pyre -n "__fish_use_subcommand" -a config -d "Show or reset configuration options"
complete -c pyre -n "__fish_use_subcommand" -a p2p -d "P2P streaming mode"
complete -c pyre -n "__fish_use_subcommand" -a completions -d "Generate shell completions"
complete -c pyre -n "__fish_use_subcommand" -a optimize -d "Mac optimizer: quit idle apps, clean caches"
complete -c pyre -n "__fish_use_subcommand" -a sleep-audit -d "Standby & sleep battery drain diagnostics"
complete -c pyre -n "__fish_use_subcommand" -a sweep -d "Developer & project build cruft sweeper"
complete -c pyre -n "__fish_use_subcommand" -a awake -d "Guardrailed keep-awake utility"
complete -c pyre -n "__fish_use_subcommand" -a net-audit -d "Outbound network and privacy flow inspector"
complete -c pyre -n "__fish_use_subcommand" -a focus -d "Turbo / Focus performance shield"
complete -c pyre -n "__fish_use_subcommand" -a ha -d "Home Assistant MQTT auto-discovery"
complete -c pyre -n "__fish_seen_subcommand_from optimize" -a "apps track memory caches trash startup dns protect unprotect help"
complete -c pyre -n "__fish_seen_subcommand_from focus" -a "on off status"
complete -c pyre -n "__fish_seen_subcommand_from ha" -a "config publish discovery state"

complete -c pyre -l json -s j -d "Output snapshot as JSON"
complete -c pyre -l html -d "Output snapshot as HTML"
complete -c pyre -l md -d "Output snapshot as Markdown"
complete -c pyre -l csv -s c -d "Output snapshot as CSV"
complete -c pyre -l tsv -s t -d "Output snapshot as TSV"
complete -c pyre -l detailed -d "Include detailed system info and sensor readings"
complete -c pyre -l theme -x -a "default dracula cyberpunk monochrome nord gruvbox" -d "Set color theme"
complete -c pyre -l sort -x -a "cpu mem pid user command state threads runtime" -d "Sort processes by key"
complete -c pyre -l reverse -s r -d "Reverse process sort order"
complete -c pyre -l temp-unit -x -a "c f" -d "Temperature unit"
`;
}

export function generatePowerShellCompletions(): string {
  return `# PowerShell completion for pyre
Register-ArgumentCompleter -Native -CommandName pyre -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $commands = @('menu', 'tui', 'launcher', 'playbook', 'flight', 'run', 'bench-git', 'statusline', 'inspect', 'containers', 'ports', 'gpu', 'leaks', 'zombies', 'live', 'check', 'pipe', 'stress', 'ui', 'launch', 'web', 'ssh', 'fleet', 'bench', 'benchmark', 'anomalies', 'doctor', 'extensions', 'brew', 'update', 'profile', 'config', 'history', 'diff', 'info', 'completions', 'p2p', 'blender', 'prometheus', 'smart', 'replay', 'explain', 'optimize', 'sleep-audit', 'sweep', 'awake', 'net-audit', 'focus', 'ha')
    $options = @('--json', '--html', '--md', '--csv', '--tsv', '--detailed', '--theme', '--interval', '--once', '--out', '--export-dir', '--log', '--tree', '--sort', '--reverse', '--kill-port', '--samples', '--packets', '--limit', '--alert-cpu', '--alert-temp', '--temp-unit', '--plain', '--help', '--version')

    $elements = $commandAst.CommandElements
    if ($elements.Count -le 2) {
        $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
    }
    $options | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
    }
}
`;
}

export function printCompletions(shell: string): void {
  const s = (shell || '').toLowerCase();
  if (s === 'bash') {
    console.log(generateBashCompletions());
  } else if (s === 'fish') {
    console.log(generateFishCompletions());
  } else if (s === 'powershell' || s === 'pwsh') {
    console.log(generatePowerShellCompletions());
  } else {
    console.log(generateZshCompletions());
  }
}


