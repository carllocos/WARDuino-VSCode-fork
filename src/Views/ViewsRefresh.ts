import * as vscode from 'vscode';

import { OldDeviceConfig } from '../DebuggerConfig';
import { OldRuntimeState} from '../State/RuntimeState';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { EventsProvider } from './EventsProvider';
import { StackProvider } from './StackProvider';
import { Context} from '../State/context';

interface ViewsConfig {
    showBreakpointPolicies: boolean;
}

export class RuntimeViewsRefresher {

    private viewsProviders: RuntimeViewRefreshInterface[];
    private extensionName: string;

    private readonly _stackProvider: StackProvider;
    private readonly _eventsProvider: EventsProvider;

    constructor(extensionName: string) {
        this.viewsProviders = [];
        this.extensionName = extensionName;

        this._stackProvider = new StackProvider();
        this._eventsProvider = new EventsProvider();
    }

    get eventsProvider(): EventsProvider {
        return this._eventsProvider;
    }

    addViewProvider(viewProvider: RuntimeViewRefreshInterface) {
        this.viewsProviders.push(viewProvider);
    }

    oldRefreshViews(runtimeState?: OldRuntimeState) {
        this.viewsProviders.forEach(v => {
            v.oldRefreshView(runtimeState);
        });
    }

    refreshViews(runtimeState?: Context) {
        this.viewsProviders.forEach(v => {
            v.refreshView(runtimeState);
        });
    }

    showViewsFromConfig(deviceConfig: OldDeviceConfig) {
        const showBreakPointPolicies = deviceConfig.isBreakpointPolicyEnabled();
        vscode.commands.executeCommand('setContext', `${this.extensionName}.showBreakpointPolicies`, showBreakPointPolicies);
    }

    setupViews(): void{

        this.addViewProvider(this._stackProvider);
        vscode.window.registerTreeDataProvider('stack', this._stackProvider);

        this.addViewProvider(this._eventsProvider);
        vscode.window.registerTreeDataProvider('events', this.eventsProvider);

        // const deviceConfig: OldDeviceConfig;

        // this.showViewsFromConfig(deviceConfig);

        // vscode.window.registerTreeDataProvider('events', eventsProvider);

        // this.proxyCallsProvider = new ProxyCallsProvider(next);
        // this.viewsRefresher.addViewProvider(this.proxyCallsProvider);
        // vscode.window.registerTreeDataProvider('proxies', this.proxyCallsProvider);
        // this.proxyCallsProvider?.setDebugBridge(next);

        // if (next.getDeviceConfig().isBreakpointPolicyEnabled()) {
        //     if (!!!this.breakpointPolicyProvider) {
        //         this.breakpointPolicyProvider = new BreakpointPolicyProvider(next);
        //         this.viewsRefresher.addViewProvider(this.breakpointPolicyProvider);
        //         vscode.window.registerTreeDataProvider('breakpointPolicies', this.breakpointPolicyProvider);
        //     } else {
        //         this.breakpointPolicyProvider.setDebugBridge(next);
        //     }
        //     this.breakpointPolicyProvider.refresh();
        // }

        // if (this.timelineProvider) {
        //     this.timelineProvider = new DebuggingTimelineProvider(next);
        //     this.viewsRefresher.addViewProvider(this.timelineProvider);
        //     const v = vscode.window.createTreeView('debuggingTimeline', {treeDataProvider: this.timelineProvider});
        //     this.timelineProvider.setView(v);
        // } else {
        //     this.timelineProvider.setDebugBridge(next);
        // }

    }

}