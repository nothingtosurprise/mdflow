import { describe, expect, it } from 'bun:test';
import {
    allDemoFlows,
    currentRun,
    demoReducer,
    initialDemoState,
    type DemoState,
    type StoryId,
} from './model';
import { screenHasFocusTarget, screenLinesFor, stripAnsi, terminalScreen } from './screens';
import { compileStory, storyFor } from './stories';

function plainScreen(state: DemoState, cols = 92): string {
    return stripAnsi(terminalScreen(state, allDemoFlows(state), cols, 26, false));
}

function withPresentation(
    state: DemoState,
    presentation: Partial<DemoState['presentation']>,
): DemoState {
    return {
        ...state,
        presentation: { ...state.presentation, ...presentation },
    };
}

function visibleLines(rendered: string): string[] {
    return stripAnsi(rendered)
        .replace(/\u001b\[[?0-9;]*[A-Za-z]/g, '')
        .split(/\r?\n/);
}

function runStory(storyId: StoryId): DemoState {
    let state = initialDemoState(storyId);
    if (storyId === 'project-setup') {
        state = demoReducer(state, { type: 'SET_PROJECT_SELECTION', selected: [1, 3] });
        state = demoReducer(state, { type: 'SET_PROJECT_STAGE', stage: 'approval' });
        return { ...state, gate: 'project-go' };
    }
    if (storyId === 'quick-create') {
        state = demoReducer(state, { type: 'SET_CREATE_INTENT', intent: 'Draft release notes from this branch' });
        state = demoReducer(state, { type: 'SET_QUICK_STAGE', stage: 'enter-boundary' });
        return { ...state, gate: 'quick-create-enter' };
    }
    if (storyId === 'personal-flows') {
        state = demoReducer(state, { type: 'SET_PERSONAL_INTENT', intent: 'Turn my notes into a daily plan' });
        state = demoReducer(state, { type: 'SET_PERSONAL_STAGE', stage: 'enter-boundary' });
        return { ...state, gate: 'personal-create-enter' };
    }
    state = demoReducer(state, { type: 'SET_EVOLVE_STAGE', stage: 'proposal' });
    state = demoReducer(state, { type: 'SET_EVOLVE_STAGE', stage: 'decision' });
    return { ...state, gate: 'evolve-apply' };
}

describe('project setup story', () => {
    it('shows real launch consent and persistent browser-fixture honesty', () => {
        let state = initialDemoState('project-setup', true);
        state = demoReducer(state, { type: 'SET_PROJECT_STAGE', stage: 'consent' });
        const screen = plainScreen(state);
        expect(screen).toContain('Launch codex?');
        expect(screen).toContain('[ENGINE]');
        expect(screen).toContain('browser did not launch codex');
        expect(screen).toContain('BROWSER SIMULATION · NO FILES / ENGINES');
    });

    it('uses a numbered 4-flow conversation and no checkbox language', () => {
        let state = initialDemoState('project-setup');
        state = demoReducer(state, { type: 'SET_PROJECT_STAGE', stage: 'selection' });
        state = demoReducer(state, { type: 'SET_PROJECT_SELECTION', selected: [1, 3] });
        const screen = plainScreen(state);
        expect(screen).toContain('1. review-changes');
        expect(screen).toContain('4. dependency-upgrade');
        expect(screen).toContain('Keep 1 and 3. Drop 2 and 4. Default engine: codex.');
        expect(screen).not.toMatch(/[☐☑]/);
        expect(screen).not.toContain('[x]');
    });

    it('stops before go, then shows only a mock receipt and free plan', () => {
        const stopped = runStory('project-setup');
        expect(plainScreen(stopped)).toContain('Type go to approve this exact roster');
        expect(plainScreen(stopped)).toContain('Nothing is written');
        expect(plainScreen(stopped)).not.toContain('You › go');

        const continued = demoReducer(stopped, { type: 'CONTINUE_SAMPLE', ...currentRun(stopped) });
        const receipt = plainScreen(continued);
        expect(receipt).toContain('You › go');
        expect(receipt).toContain('SAMPLE RECEIPT AFTER EXPLICIT go');
        expect(receipt).toContain('[FREE] md review-changes --_dry-run');
        expect(receipt).toContain('No repository files were written');
        expect(receipt).not.toContain('behavioral proof achieved');
    });
});

describe('quick create story', () => {
    it('asks the exact one question and does not invent a preview or confirmation step', () => {
        let state = initialDemoState('quick-create');
        state = demoReducer(state, { type: 'SET_QUICK_STAGE', stage: 'question' });
        const screen = plainScreen(state);
        expect(screen).toContain('What should this flow do?');
        expect(screen.toLowerCase()).not.toContain('preview');
        expect(screen.toLowerCase()).not.toContain('confirm');
    });

    it('does not show a created file until the explicit continued Enter fixture', () => {
        const stopped = runStory('quick-create');
        expect(plainScreen(stopped)).toContain('Autoplay stopped before Enter');
        expect(plainScreen(stopped)).not.toContain('Created flow:');

        const continued = demoReducer(stopped, { type: 'CONTINUE_SAMPLE', ...currentRun(stopped) });
        const receipt = plainScreen(continued);
        expect(receipt).toContain('Created flow: ~/dev/atlas-web/flows/draft-release-notes-from-this-branch.md');
        expect(receipt).toContain('not evaluated');
        expect(receipt).toContain('Browser memory only');
    });
});

describe('safe evolution story', () => {
    it('labels proposal claims as fixture data and stops before A', () => {
        const stopped = runStory('evolve-safely');
        const screen = plainScreen(stopped);
        expect(screen).toContain('DECISION BOUNDARY');
        expect(screen).toContain('Autoplay never presses A');
        expect(screen).toContain('A open apply confirmation');
        expect(screen).not.toContain('APPLIED · DEMO STATE');
    });

    it('shows the exact A/R confirmation controls and shell commands', () => {
        let state = runStory('evolve-safely');
        state = demoReducer(state, { type: 'REQUEST_APPLY' });
        let screen = plainScreen(state);
        expect(screen).toContain('Shell: md evolve apply evr_demo_01');
        expect(screen).toContain('Enter / C confirm');

        state = demoReducer(state, { type: 'APPLY_FIXTURE' });
        state = demoReducer(state, { type: 'REQUEST_ROLLBACK' });
        screen = plainScreen(state);
        expect(screen).toContain('Shell: md evolve rollback evr_demo_01');
        expect(screen).toContain('Enter / C confirm');
    });
});

describe('personal flow story', () => {
    it('creates in ~/.mdflow and does not present a registry installation', () => {
        const stopped = runStory('personal-flows');
        const screen = plainScreen(stopped);
        expect(screen).toContain('md create --global');
        expect(screen).toContain('~/.mdflow/turn-my-notes-into-a-daily-plan.md');
        expect(screen).toContain('not a registry install');
        expect(screen).not.toContain('Installed flow');
    });

    it('continues with another-project dry-run, user resolution, and project shadowing', () => {
        const stopped = runStory('personal-flows');
        const continued = demoReducer(stopped, { type: 'CONTINUE_SAMPLE', ...currentRun(stopped) });
        const screen = plainScreen(continued);
        expect(screen).toContain('cd ~/dev/harbor-api');
        expect(screen).toContain('[FREE] Resolved: ~/.mdflow/turn-my-notes-into-a-daily-plan.md');
        expect(screen).toContain('project flows/turn-my-notes-into-a-daily-plan.md would shadow');
        expect(screen).toContain('No engine invoked');
        expect(screen).toContain('not behavioral quality');
    });
});

describe('semantic focus and human typing presentation', () => {
    it('keeps every internally rendered row as an identified screen-line object', () => {
        const lines = screenLinesFor(initialDemoState('project-setup'));
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.every((line) => typeof line.content === 'string')).toBe(true);
        expect(lines.some((line) => line.id === 'shell-command')).toBe(true);
    });

    it('reserves a two-column gutter and paints exactly one orange focus rail', () => {
        let state = initialDemoState('project-setup');
        state = demoReducer(state, { type: 'SET_PROJECT_STAGE', stage: 'suggestions' });
        state = withPresentation(state, { focus: 'suggestion-2' });

        const rendered = terminalScreen(state, allDemoFlows(state), 92, 26, false);
        const lines = visibleLines(rendered);
        expect(lines.filter((line) => line.startsWith('▎ '))).toHaveLength(1);
        expect(lines.find((line) => line.includes('2. release-check'))).toStartWith('▎ ');
        expect(lines.every((line) => line.startsWith('  ') || line.startsWith('▎ '))).toBe(true);
        expect(rendered.match(/\u001b\[38;2;251;146;60m▎ /g)).toHaveLength(1);
    });

    it('leaves the stable blank gutter when no semantic target has focus', () => {
        const state = withPresentation(initialDemoState('quick-create'), { focus: null });
        const lines = visibleLines(terminalScreen(state, allDemoFlows(state), 92, 26, false));
        expect(lines.every((line) => line.startsWith('  '))).toBe(true);
        expect(lines.some((line) => line.startsWith('▎ '))).toBe(false);
    });

    it('resolves every focus target against its applicable screen', () => {
        let project = initialDemoState('project-setup');
        expect(screenHasFocusTarget(project, 'shell-command')).toBe(true);
        project = demoReducer(project, { type: 'SET_PROJECT_STAGE', stage: 'consent' });
        expect(screenHasFocusTarget(project, 'consent-agent')).toBe(true);
        expect(screenHasFocusTarget(project, 'consent-launch')).toBe(true);
        project = demoReducer(project, { type: 'SET_PROJECT_STAGE', stage: 'inspection' });
        expect(screenHasFocusTarget(project, 'shell-command')).toBe(true);
        project = demoReducer(project, { type: 'SET_PROJECT_STAGE', stage: 'suggestions' });
        for (const target of ['suggestion-1', 'suggestion-2', 'suggestion-3', 'suggestion-4'] as const) {
            expect(screenHasFocusTarget(project, target)).toBe(true);
        }
        project = demoReducer(project, { type: 'SET_PROJECT_STAGE', stage: 'selection' });
        expect(screenHasFocusTarget(project, 'selection-reply')).toBe(true);
        project = demoReducer(project, { type: 'SET_PROJECT_STAGE', stage: 'approval' });
        expect(screenHasFocusTarget(project, 'write-gate')).toBe(true);

        let quick = initialDemoState('quick-create');
        quick = demoReducer(quick, { type: 'SET_QUICK_STAGE', stage: 'question' });
        expect(screenHasFocusTarget(quick, 'intent-input')).toBe(true);

        let evolve = initialDemoState('evolve-safely');
        expect(screenHasFocusTarget(evolve, 'sample-result')).toBe(true);
        evolve = demoReducer(evolve, { type: 'SET_EVOLVE_STAGE', stage: 'feedback' });
        expect(screenHasFocusTarget(evolve, 'feedback-input')).toBe(true);
        evolve = demoReducer(evolve, { type: 'SET_EVOLVE_STAGE', stage: 'feedback-saved' });
        expect(screenHasFocusTarget(evolve, 'feedback-input')).toBe(true);
        evolve = demoReducer(evolve, { type: 'SET_EVOLVE_STAGE', stage: 'plan' });
        expect(screenHasFocusTarget(evolve, 'plan')).toBe(true);
        evolve = demoReducer(evolve, { type: 'SET_EVOLVE_STAGE', stage: 'proposal' });
        expect(screenHasFocusTarget(evolve, 'proposal')).toBe(true);
        evolve = demoReducer(evolve, { type: 'SET_EVOLVE_STAGE', stage: 'diff' });
        expect(screenHasFocusTarget(evolve, 'diff')).toBe(true);
        evolve = demoReducer(evolve, { type: 'SET_EVOLVE_STAGE', stage: 'decision' });
        expect(screenHasFocusTarget(evolve, 'decision')).toBe(true);
        evolve = demoReducer(evolve, { type: 'REQUEST_APPLY' });
        expect(screenHasFocusTarget(evolve, 'confirmation')).toBe(true);
        evolve = demoReducer(evolve, { type: 'APPLY_FIXTURE' });
        expect(screenHasFocusTarget(evolve, 'confirmation')).toBe(true);
        evolve = demoReducer(evolve, { type: 'REQUEST_ROLLBACK' });
        evolve = demoReducer(evolve, { type: 'ROLLBACK_FIXTURE' });
        expect(screenHasFocusTarget(evolve, 'confirmation')).toBe(true);

        let personal = initialDemoState('personal-flows');
        personal = demoReducer(personal, { type: 'SET_PERSONAL_STAGE', stage: 'cross-project' });
        expect(screenHasFocusTarget(personal, 'personal-resolution')).toBe(true);
    });

    it('resolves every focus phase in all four compiled stories', () => {
        for (const storyId of ['project-setup', 'quick-create', 'evolve-safely', 'personal-flows'] as const) {
            let state = initialDemoState(storyId);
            for (const phase of compileStory(storyFor(storyId))) {
                if (phase.action) state = demoReducer(state, phase.action);
                state = withPresentation(state, {
                    focus: phase.focus,
                    typingField: phase.typingField,
                    typingText: phase.typingText,
                    typingActive: phase.typingActive,
                });
                if (phase.focus !== null) {
                    expect(screenHasFocusTarget(state, phase.focus)).toBe(true);
                }
            }
        }
    });

    it('renders presentation-only typing with a painted caret without mutating domain text', () => {
        let state = initialDemoState('quick-create');
        state = demoReducer(state, { type: 'SET_QUICK_STAGE', stage: 'question' });
        state = {
            ...state,
            createIntent: 'domain text stays intact',
            presentation: {
                focus: 'intent-input',
                typingField: 'createIntent',
                typingText: 'Draft release no',
                typingActive: true,
            },
        };

        const typing = plainScreen(state);
        expect(typing).toContain('Draft release no▌');
        expect(typing).not.toContain('domain text stays intact');
        expect(state.createIntent).toBe('domain text stays intact');

        const complete = withPresentation(state, { typingActive: false, typingField: null, typingText: '' });
        expect(plainScreen(complete)).toContain('domain text stays intact');
        expect(plainScreen(complete)).not.toContain('▌');
    });

    it('shows a caret for manually edited focused text and removes it for reduced motion', () => {
        let state = initialDemoState('evolve-safely');
        state = demoReducer(state, { type: 'SET_FEEDBACK', feedback: 'Observed race' });
        state = withPresentation(state, { focus: 'feedback-input' });
        expect(plainScreen(state)).toContain('Observed race▌');

        const reduced = stripAnsi(terminalScreen(state, allDemoFlows(state), 92, 26, true));
        expect(reduced).not.toContain('▌');
        expect(reduced).toContain('▎ ');
    });
});

describe('terminal rendering safety', () => {
    it('uses green FREE, yellow ENGINE, and blue LOCAL WRITE labels', () => {
        let free = initialDemoState('evolve-safely');
        free = demoReducer(free, { type: 'PLAN' });
        expect(terminalScreen(free, allDemoFlows(free), 92, 26, false)).toContain('\u001b[38;2;52;211;153m[FREE]');

        let engine = initialDemoState('evolve-safely');
        engine = demoReducer(engine, { type: 'LOAD_PROPOSAL_FIXTURE' });
        expect(terminalScreen(engine, allDemoFlows(engine), 92, 26, false)).toContain('\u001b[38;2;251;191;36m[ENGINE]');

        engine = demoReducer(engine, { type: 'SHOW_DECISION' });
        expect(terminalScreen(engine, allDemoFlows(engine), 92, 26, false)).toContain('\u001b[38;2;96;165;250m[LOCAL WRITE]');
    });

    it('clips every ANSI-rendered line to narrow terminal columns', () => {
        let state = initialDemoState('project-setup');
        state = demoReducer(state, { type: 'SET_PROJECT_STAGE', stage: 'suggestions' });
        const rendered = terminalScreen(state, allDemoFlows(state), 38, 22, false);
        const visibleLines = stripAnsi(rendered)
            .replace(/\u001b\[[?0-9;]*[A-Za-z]/g, '')
            .split(/\r?\n/);
        expect(Math.max(...visibleLines.map((line) => Array.from(line).length))).toBeLessThanOrEqual(38);
    });

    it('always hides the actual terminal cursor, including while text accepts input', () => {
        const state = demoReducer(initialDemoState('quick-create'), { type: 'SET_QUICK_STAGE', stage: 'question' });
        const animated = terminalScreen(state, allDemoFlows(state), 92, 26, false);
        const rendered = terminalScreen(state, allDemoFlows(state), 92, 26, true);
        expect(animated).toContain('\u001b[?25l');
        expect(animated).not.toContain('\u001b[?25h');
        expect(rendered).toContain('\u001b[?25l');
        expect(rendered).not.toContain('\u001b[?25h');
    });
});
