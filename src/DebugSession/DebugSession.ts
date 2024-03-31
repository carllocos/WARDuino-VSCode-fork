import {DebugProtocol} from 'vscode-debugprotocol';
import {basename} from 'path-browserify';
import * as vscode from 'vscode';

import {
    ContinuedEvent,
    ExitedEvent,
    Handles,
    InitializedEvent,
    LoggingDebugSession,
    Scope,
    Source,
    StackFrame,
    StoppedEvent,
    TerminatedEvent,
    Thread
} from 'vscode-debugadapter';
import {CompileTimeError} from '../CompilerBridges/CompileTimeError';
import {ErrorReporter} from './ErrorReporter';
import {DebugBridge} from '../DebugBridges/DebugBridge';
import {CompileBridge} from '../CompilerBridges/CompileBridge';
import {getLocationForAddress} from '../State/SourceMap';
import {ProxyCallsProvider} from '../Views/ProxyCallsProvider';
import {CompileResult} from '../CompilerBridges/CompileBridge';
import {createUserConfigFromLaunchArgs} from '../DebuggerConfig';
import {BreakpointPolicyItem, BreakpointPolicyProvider} from '../Views/BreakpointPolicyProvider';
import {BreakpointPolicy} from '../State/Breakpoint';
import {DebuggingTimelineProvider, TimelineItem} from '../Views/DebuggingTimelineProvider';
import {OldRuntimeState} from '../State/RuntimeState';
import {CallstackFrame} from '../State/context';
import {DeviceManager, VariableInfo} from 'wasmito';
import { RemoteDebuggerBackend, createDebuggerBackend } from './DebuggerBackend';
import { ViewsManager } from '../Views/ViewsManager';


interface OnStartBreakpoint {
    source: {
        name: string,
        path: string
    },
    linenr: number
}

// Interface between the debugger and the VS runtime
export class WARDuinoDebugSession extends LoggingDebugSession {
    private program: string = '';
    readonly THREAD_ID: number = 42;
    private debugBridge?: DebugBridge;
    // private proxyBridge?: DebugBridge;
    private notifier: vscode.StatusBarItem;
    private reporter: ErrorReporter;
    private timelineProvider?: DebuggingTimelineProvider;


    private variableHandles = new Handles<'locals' | 'globals' | 'arguments'>();
    private compiler?: CompileBridge;

    public readonly devicesManager =  new DeviceManager();
    public readonly viewsManager: ViewsManager = new ViewsManager(this);
    private startingBPs: OnStartBreakpoint[];

    private selectedDebugBackend?: RemoteDebuggerBackend;

    public constructor(notifier: vscode.StatusBarItem, reporter: ErrorReporter) {
        super('debug_log.txt');
        this.notifier = notifier;
        this.reporter = reporter;
        this.startingBPs = [];
        this.setDebuggerLinesStartAt1(true);
    }

    public focusDebuggingOnDevice(dbg: RemoteDebuggerBackend): void{
        this.selectedDebugBackend = dbg;
        this.viewsManager.showViews(dbg);
        if(dbg.isPaused()){
            this.onPause();
        }
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        // build and return the capabilities of this debug adapter:
        response.body = response.body || {};

        // the adapter implements the configurationDone request.
        response.body.supportsConfigurationDoneRequest = true;

        // make VS Code use 'evaluate' when hovering over source
        response.body.supportsEvaluateForHovers = false;

        // make VS Code show a 'step back' button
        response.body.supportsStepBack = true;

        // make VS Code support data breakpoints
        response.body.supportsDataBreakpoints = false;

        // make VS Code support completion in REPL
        response.body.supportsCompletionsRequest = false;
        response.body.completionTriggerCharacters = ['.', '['];

        // make VS Code send cancel request
        response.body.supportsCancelRequest = false;

        // make VS Code send the breakpointLocations request
        response.body.supportsBreakpointLocationsRequest = true;

        // make VS Code provide "Step in Target" functionality
        response.body.supportsStepInTargetsRequest = false;

        // the adapter defines two exceptions filters, one with support for conditions.
        response.body.supportsExceptionFilterOptions = false;

        // make VS Code send exceptionInfo request
        response.body.supportsExceptionInfoRequest = false;

        // make VS Code send setVariable request
        response.body.supportsSetVariable = true;

        // make VS Code send setExpression request
        response.body.supportsSetExpression = false;

        // make VS Code send disassemble request
        response.body.supportsDisassembleRequest = false;
        response.body.supportsSteppingGranularity = false;
        response.body.supportsInstructionBreakpoints = false;

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    // PROTOCOL implementation
    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);
    }

    protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
        response.body = {
            breakpoints: this.debugBridge?.getBreakpointPossibilities() ?? []
        };
        this.sendResponse(response);
    }

    private saveBreakpointsUntilBackendOpens(sourceName: string, sourcePath: string, linenrs: number[]): void {
        const bps = linenrs.map((linenr: number) => {
            return {
                'source': {
                    name: sourceName,
                    path: sourcePath
                },
                'linenr': linenr
            };
        });
        this.startingBPs = this.startingBPs.concat(bps);
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request): Promise<void> {

        if (this.selectedDebugBackend === undefined) {
            // case where the backend did not start yet.
            // Store bps so to set them after connection to backend 
            if(args.lines !== undefined){
                this.saveBreakpointsUntilBackendOpens(args.source.name!, args.source.path!, args.lines!);
            }
        }
        else {
            await this.selectedDebugBackend!.setBreakPoints(args.lines ?? []);
            const bps = this.selectedDebugBackend!.breakpoints.map( bp =>{
                return {
                    verified: true,
                    line: bp.sourceCodeLocation.linenr,
                    column: bp.sourceCodeLocation.columnEnd,
                    endLine: bp.sourceCodeLocation.columnEnd,
                    source: bp.source,
                };

            });
            response.body = {
                breakpoints: bps
            };
        }

        this.sendResponse(response);
    }

    protected setInstructionBreakpointsRequest(response: DebugProtocol.SetInstructionBreakpointsResponse, args: DebugProtocol.SetInstructionBreakpointsArguments) {
        console.log('setInstructionBreakpointsRequest');
        response.body = {
            breakpoints: []
        };
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [new Thread(this.THREAD_ID, 'WARDuino Debug Thread')]
        };
        this.sendResponse(response);
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        response.body = {
            scopes: [
                new Scope('Locals', this.variableHandles.create('locals'), false),
                new Scope('Globals', this.variableHandles.create('globals'), false),
                new Scope('Arguments', this.variableHandles.create('arguments'), false),
            ]
        };
        this.sendResponse(response);
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments,
        request?: DebugProtocol.Request) {

        const frame = this.getViewSelectedFrame();
        if(frame === undefined){
            this.sendResponse(response);
            return;
        }

        let vars: any[]=[];
        switch(this.variableHandles.get(args.variablesReference)){
            case 'locals':
                vars = frame.locals;
                break;
            case 'globals':
                vars = this.selectedDebugBackend!.getCurrentContext()!.globals.values;
                break;
            case 'arguments':
                vars = frame.arguments;
                break;
        };

       
        response.body = {
            variables: vars. map((local) => {
                const name = local.name === ''
                    ? local.index.toString()
                    : local.name;
                return {
                    name: name,
                    value: local.value.toString(), variablesReference: 0
                };
            })
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments): void {
        const context = this.selectedDebugBackend?.getCurrentContext();
        if(context === undefined){
            this.sendResponse(response);
            return;
        }
        const callstack = context.callstack.frames().reverse();
        const frames = Array.from(callstack, (frame) => {
            const sourceCodeLocation = frame.sourceCodeLocation;
            let lineNr: undefined | number;
            let colstart: undefined | number;
            let colEnd: undefined | number;
            if(sourceCodeLocation !== undefined){
                // TODO: figure out why convertDebggerLineToClient has line Starts at one setDebuggerStartAt1(true)
                lineNr = this.convertDebuggerLineToClient(sourceCodeLocation.linenr),
                colstart = this.convertDebuggerColumnToClient(sourceCodeLocation.columnStart - 1);
                colEnd = this.convertDebuggerColumnToClient(sourceCodeLocation.columnEnd - 1);
            }
            const name = (frame.function === undefined) ? '<anonymous>' : frame.function.name;
            const src = frame.sourceCodeLocation === undefined ? undefined : this.createSource(frame.sourceCodeLocation.source);
            const f = new StackFrame(frame.index, name,
                src,
                lineNr,
                colstart
            );
            if(colEnd !== undefined){
                f.endColumn = colEnd;
            }
            return f;
        });
        response.body = {
            stackFrames: frames,
            totalFrames: frames.length
        };

        this.sendResponse(response);
    }

    private createSource(filePath: string): Source {
        return new Source(filePath, this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mock-adapter-data');
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        await this.selectedDebugBackend?.step(10000);
        this.sendResponse(response);
        this.sendEvent(new StoppedEvent('step', this.THREAD_ID));
    }

    protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments, request?: DebugProtocol.Request): void {
        this.sendResponse(response);
        this.debugBridge?.stepBack();
    }

    private async setMissedBreakpoints(): Promise<void> {
        if(this.selectedDebugBackend === undefined || this.startingBPs.length === 0){
            return;
        }

        const sm = this.selectedDebugBackend.getSourceMap();
        console.warn('fixe setMissedBreakpoints to use right sourceNames');
        const filename = sm.sourcesNames[0];
        const bps = this.startingBPs.filter(bp=>bp.source.name === filename).map(bp=>bp.linenr);
        this.startingBPs = this.startingBPs.filter(bp=>bp.source.name !== filename);
        await this.selectedDebugBackend.setBreakPoints(bps);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: any): Promise<void> {
        try{
            const config = await createUserConfigFromLaunchArgs(args);
            const dc = config.devices.find((d)=>{
                return !!d.debug;
            });
            if(dc === undefined){
                throw Error('At least one device should be selected for debugging');

            }

            this.selectedDebugBackend = await createDebuggerBackend(this.devicesManager, dc);
            this.viewsManager.createViews(this.selectedDebugBackend);
            this.viewsManager.showViews(this.selectedDebugBackend);

            this.sendResponse(response);

            // set bps that could not be set during start
            await this.setMissedBreakpoints();
            if(this.selectedDebugBackend.isPaused()){
                await this.selectedDebugBackend.refreshState(); // TODO make more general
                this.onPause();
            } else{
                this.onRunning();
            }
        }
        catch(e){
            console.error(e);
            console.log('TODO: Stop the debugger automatically and emit window with error message');
        }
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): Promise<void> {
        await this.selectedDebugBackend?.run();
        this.sendResponse(response);
    }

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request): Promise<void> {
        await this.selectedDebugBackend?.pause();
        this.sendResponse(response);
        this.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
    }

    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
        // const v = this.variableHandles.get(args.variablesReference);
        // const db = this.debugBridge;
        // const state = db?.getCurrentState();
        // const isPresent = db?.getDebuggingTimeline().isActiveStatePresent();
        // const isUpdateAllowed = db?.isUpdateOperationAllowed();
        // let newvariable: VariableInfo | undefined = undefined;
        // if (v === 'locals' && db && state) {
        //     if (isUpdateAllowed) {
        //         newvariable = state.updateLocal(args.name, args.value);
        //         if (!!newvariable) {
        //             if (!!!isPresent) {
        //                 await db.pushSession(state.getSendableState());
        //                 db.getDebuggingTimeline().makeCurrentStateNewPresent();
        //                 this.timelineProvider?.oldRefreshView();
        //             }
        //             await db.updateLocal(newvariable);
        //         } else {
        //             newvariable = state?.getLocal(args.name);
        //         }
        //     } else {
        //         newvariable = state?.getLocal(args.name);
        //     }
        // } else if (v === 'globals' && db && state) {
        //     if (isUpdateAllowed) {
        //         newvariable = state?.updateGlobal(args.name, args.value);
        //         if (!!newvariable) {
        //             if (!!!isPresent) {
        //                 await db.pushSession(state.getSendableState());
        //                 db.getDebuggingTimeline().makeCurrentStateNewPresent();
        //                 this.timelineProvider?.oldRefreshView();
        //             }
        //             await this.debugBridge?.updateGlobal(newvariable);
        //         } else {
        //             newvariable = state?.getGlobal(args.name);
        //         }
        //     } else {
        //         newvariable = state?.getGlobal(args.name);
        //     }
        // } else if (v === 'arguments' && db && state) {
        //     if (isUpdateAllowed) {
        //         newvariable = state?.updateArgument(args.name, args.value);
        //         if (!!newvariable) {
        //             if (!!!isPresent) {
        //                 await db.pushSession(state.getSendableState());
        //                 db.getDebuggingTimeline().makeCurrentStateNewPresent();
        //                 this.timelineProvider?.oldRefreshView();
        //             }
        //             await this.debugBridge?.updateArgument(newvariable);
        //         } else {
        //             newvariable = state?.getArgument(args.name);
        //         }
        //     } else {
        //         newvariable = state?.getArgument(args.name);
        //     }
        // }

        // if (!!!isUpdateAllowed) {
        //     this.onDisallowedAction(this.debugBridge!, 'Update value disallowed in viewing mode');
        // }

        // response.body = {
        //     value: newvariable!.value,
        // };
        this.sendResponse(response);
    }

    private getViewSelectedFrame(): CallstackFrame | undefined {
        // There is currently no VSCode API support to determine which frame from the stacktrace is currently focused on.
        // This is important to provide the right context
        // For now we always take the latest function frame
        if(this.selectedDebugBackend === undefined || this.selectedDebugBackend.getCurrentContext() === undefined){ 
            return undefined;
        }

        const context = this.selectedDebugBackend.getCurrentContext();
        return context?.callstack.getCurrentFunctionFrame();
    }


    // private setDebugBridge(next: DebugBridge) {
    //     if (this.debugBridge !== undefined) {
    //         next.setSelectedProxies(this.debugBridge.getSelectedProxies());
    //     }
    //     this.debugBridge = next;
    //     if (this.proxyCallsProvider === undefined) {
    //         this.proxyCallsProvider = new ProxyCallsProvider(next);
    //         this.viewsRefresher.addViewProvider(this.proxyCallsProvider);
    //         vscode.window.registerTreeDataProvider('proxies', this.proxyCallsProvider);

    //     } else {
    //         this.proxyCallsProvider?.setDebugBridge(next);
    //     }

    //     if (next.getDeviceConfig().isBreakpointPolicyEnabled()) {
    //         if (!!!this.breakpointPolicyProvider) {
    //             this.breakpointPolicyProvider = new BreakpointPolicyProvider(next);
    //             this.viewsRefresher.addViewProvider(this.breakpointPolicyProvider);
    //             vscode.window.registerTreeDataProvider('breakpointPolicies', this.breakpointPolicyProvider);
    //         } else {
    //             this.breakpointPolicyProvider.setDebugBridge(next);
    //         }
    //         this.breakpointPolicyProvider.refresh();
    //     }

    //     if (!!!this.timelineProvider) {
    //         this.timelineProvider = new DebuggingTimelineProvider(next);
    //         this.viewsRefresher.addViewProvider(this.timelineProvider);
    //         const v = vscode.window.createTreeView('debuggingTimeline', {treeDataProvider: this.timelineProvider});
    //         this.timelineProvider.setView(v);
    //     } else {
    //         this.timelineProvider.setDebugBridge(next);
    //     }

    //     if (this.stackProvider) {
    //         this.stackProvider.setDebugBridge(next);
    //     } else {
    //         this.stackProvider = new StackProvider(next);
    //         this.viewsRefresher.addViewProvider(this.stackProvider);
    //         vscode.window.registerTreeDataProvider('stack', this.stackProvider);
    //     }
    // }


    // Commands

    public upload() {
        this.debugBridge?.upload();
    }

    public async updateModule(): Promise<void> {
        let res: void | CompileResult = await this.compiler?.compile().catch((reason) => this.handleCompileError(reason));
        if (!!res) {
            if (!!res.wasm) {
                // remove no longer needed breakpoints
                const invalidBpsAfterUpdate = this.debugBridge?.getBreakpoints().filter(bp => bp.id > res!.wasm.length) || [];
                await Promise.all(invalidBpsAfterUpdate.map(bp => this.debugBridge?.unsetBreakPoint(bp)));

                // this.sourceMap = res.sourceMap;
                this.notifyProgress('updating module...');
                await this.debugBridge?.updateModule(res.wasm);
                this.debugBridge?.updateSourceMapper(res.sourceMap);
                // this.viewsRefresher.oldRefreshViews();
                await this.debugBridge?.refresh();
                this.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
            }
        }
    }

    public async commitChanges(): Promise<void> {
        // const proxyBridge = this.devicesManager.getProxyBridge(this.debugBridge!);
        // const res = await this.compiler?.compile();

        // if (!(res && res.wasm)) {
        //     return;
        // }

        // if (proxyBridge?.getDeviceConfig().usesWiFi()) {
        //     proxyBridge?.disconnectMonitor();
        // } else {
        //     this.debugBridge?.disconnect();
        //     const flash = false;
        //     await proxyBridge?.connect(flash);
        // }

        // // remove no longer needed breakpoints
        // const invalidBpsAfterUpdate = proxyBridge!.getBreakpoints().filter(bp => bp.id > res!.wasm.length) || [];
        // await Promise.all(invalidBpsAfterUpdate.map(bp => proxyBridge!.unsetBreakPoint(bp)));

        // await proxyBridge!.updateModule(res.wasm);
        // this.viewsRefresher.refreshViews();
        // proxyBridge!.updateSourceMapper(res.sourceMap);
        // this.sourceMap = res.sourceMap;

        // this.setDebugBridge(proxyBridge!);

        // if (proxyBridge!.getDeviceConfig().isBreakpointPolicyEnabled() && proxyBridge!.getDeviceConfig().getBreakpointPolicy() !== BreakpointPolicy.default) {
        //     this.onRunning();
        // } else {
        //     await proxyBridge?.refresh();
        //     this.onPause();
        // }
    }

    public async startMultiverseDebugging() {
        const index = this.debugBridge?.getDebuggingTimeline().getIndexOfActiveState();
        const item = this.timelineProvider?.getItemFromTimeLineIndex(index ?? -1);
        if (!!item) {
            await this.saveRuntimeState(item);
            const bridge = this.debugBridge;
            const state = this.debugBridge?.getCurrentState();
            this.startDebuggingOnEmulatorHelper(bridge!, state!);
        }
    }

    public popEvent() {
        this.selectedDebugBackend?.handleEvent(0);
        // this.debugBridge?.popEvent();
    }

    public showViewOnRuntimeState(item: TimelineItem) {
        const index = item.getTimelineIndex();
        if (!this.debugBridge?.getDebuggingTimeline().activateStateFromIndex(index)) {
            this.debugBridge?.getDebuggingTimeline().advanceToPresent();
        }
        const state = this.debugBridge?.getCurrentState();
        if (!!state) {
            const doNotSave = {includeInTimeline: false};
            this.debugBridge?.updateRuntimeState(state, doNotSave);
            this.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
        }
    }


    public async saveRuntimeState(item: TimelineItem) {
        const itemIdx = item.getTimelineIndex();
        const timeline = this.debugBridge?.getDebuggingTimeline();
        const numberStates = timeline?.size();
        const savingPresentState = (itemIdx + 1) === numberStates;

        // only save the present state
        if (savingPresentState && !!timeline?.isActiveStatePresent()) {
            this.notifyInfoMessage(this.debugBridge!, 'Retrieving and saving state');
            this.timelineProvider?.showItemAsBeingSaved(item);
            this.timelineProvider?.oldRefreshView();
            await this.debugBridge?.requestMissingState();
            this.debugBridge?.emitNewStateEvent();
        }
    }

    public async startDebuggingOnEmulator(item: TimelineItem) {
        const itemIdx = item.getTimelineIndex();
        const state = this.debugBridge?.getDebuggingTimeline().getStateFromIndex(itemIdx);
        if (!!!state || !state.hasAllState()) {
            return;
        }
        const bridge = item.getDebuggerBridge();
        const stateToUse = item.getRuntimeState();
        await this.startDebuggingOnEmulatorHelper(bridge, stateToUse);
    }

    //

    private async startDebuggingOnEmulatorHelper(bridge: DebugBridge, stateToUse: OldRuntimeState) {

        // const config = bridge.getDeviceConfig();
        // const name = `${config.name} (Proxied Emulator)`;
        // const dc = OldDeviceConfig.configForProxy(name, config);
        // const state = stateToUse.deepcopy();

        // const newBridge = DebugBridgeFactory.makeDebugBridge(this.program, dc, this.sourceMap as SourceMap, RunTimeTarget.wood, this.tmpdir);
        // this.registerGUICallbacks(newBridge);
        // await bridge.proxify();

        // if (!config.usesWiFi()) {
        //     bridge.disconnect();
        // }
        // console.log('Plugin: transfer state received.');

        // try {
        //     await newBridge.connect();
        //     this.devicesManager.addDevice(newBridge, bridge);
        //     this.setDebugBridge(newBridge);
        //     await newBridge.pushSession(state.getSendableState());
        //     await (newBridge as WOODDebugBridge).specifyProxyCalls();
        //     newBridge.updateRuntimeState(state);
        //     this.onPause();
        // } catch (reason) {
        //     console.error(reason);
        // }
    }

    public async swithDebuggingTarget() {
        // if (!!!this.debugBridge) {
        //     return;
        // }
        // let br = undefined;
        // if (this.debugBridge.getDeviceConfig().isForHardware()) {
        //     br = this.devicesManager.getEmulatorBridge(this.debugBridge);
        // } else {
        //     br = this.devicesManager.getProxyBridge(this.debugBridge);
        // }
        // if (!!br) {
        //     this.setDebugBridge(br);
        //     const state = br.getDebuggingTimeline().getActiveState();
        //     this.viewsRefresher.refreshViews(state);
        //     this.onConnected(br);
        //     this.onPause();
        // }
    }

    private handleCompileError(handleCompileError: CompileTimeError) {
        let range = new vscode.Range(handleCompileError.lineInfo.line - 1,
            handleCompileError.lineInfo.column,
            handleCompileError.lineInfo.line - 1,
            handleCompileError.lineInfo.column);
        this.reporter.report(range, this.program, handleCompileError.message);
        this.sendEvent(new TerminatedEvent());
    }

   

    override shutdown(): void {
        console.log('Shutting the debugger down');
        this.debugBridge?.disconnect();
        // if (this.tmpdir) {
        //     fs.rm(this.tmpdir, {recursive: true}, err => {
        //         if (err) {
        //             throw new Error('Could not delete temporary directory.');
        //         }
        //     });
        // }
    }

    public notifyStepCompleted() {
        this.sendEvent(new StoppedEvent('step', this.THREAD_ID));
    }


    private registerGUICallbacks(debugBridge: DebugBridge) {
        // debugBridge.on(EventsMessages.stateUpdated, (newState: OldRuntimeState) => {
        //     this.onNewState(newState);
        // });
        // debugBridge.on(EventsMessages.moduleUpdated, (db: DebugBridge) => {
        //     this.notifyInfoMessage(db, EventsMessages.moduleUpdated);
        // });
        // debugBridge.on(EventsMessages.stepCompleted, () => {
        //     this.onStepCompleted();
        // });
        // debugBridge.on(EventsMessages.running, () => {
        //     this.onRunning();
        // });
        // debugBridge.on(EventsMessages.paused, () => {
        //     this.onPause();
        // });
        // debugBridge.on(EventsMessages.exceptionOccurred, (db: DebugBridge, state: OldRuntimeState) => {
        //     this.onException(db, state);
        // });
        // debugBridge.on(EventsMessages.enforcingBreakpointPolicy, (db: DebugBridge, policy: BreakpointPolicy) => {
        //     this.onEnforcingBPPolicy(db, policy);
        // });
        // debugBridge.on(EventsMessages.atBreakpoint, (db: DebugBridge, line: any) => {
        //     if (db.getDeviceConfig().isBreakpointPolicyEnabled()) {
        //         if (db.getDeviceConfig().getBreakpointPolicy() !== BreakpointPolicy.default) {
        //             let msg = 'reached breakpoint';
        //             if (line !== undefined) {
        //                 msg += ` at line ${line}`;
        //             }
        //             this.notifyInfoMessage(db, msg);
        //         }
        //     }
        // });
        // debugBridge.on(EventsMessages.emulatorStarted, (db: DebugBridge) => {
        //     const name = db.getDeviceConfig().name;
        //     const msg = `Emulator for ${name} spawned`;
        //     this.notifyProgress(msg);
        // });
        // debugBridge.on(EventsMessages.emulatorClosed, (db: DebugBridge, reason: number | null) => {
        //     const name = db.getDeviceConfig().name;
        //     let msg = `Emulator for ${name} closed`;
        //     if (reason !== null) {
        //         msg += ` reason: ${reason}`;
        //     }
        //     this.notifyProgress(msg);
        // });
        // debugBridge.on(EventsMessages.connected, (db: DebugBridge) => {
        //     this.onConnected(db);
        // });
        // debugBridge.on(EventsMessages.disconnected, (db: DebugBridge) => {
        //     const name = db.getDeviceConfig().name;
        //     const msg = `Disconected from ${name}`;
        //     this.notifyProgress(msg);
        //     this.notifyInfoMessage(db, 'Disconnected');
        // });
        // debugBridge.on(EventsMessages.connectionError, (db: DebugBridge, err: number | null) => {
        //     const name = db.getDeviceConfig().name;
        //     let msg = `Connection to ${name} failed`;
        //     if (err !== null) {
        //         msg += ` reason: ${err}`;
        //     }
        //     this.notifyProgress(msg);
        // });
        // debugBridge.on(EventsMessages.progress, (db: DebugBridge, msg: string) => {
        //     this.notifyInfoMessage(db, msg);
        // });
        // debugBridge.on(EventsMessages.errorInProgress, (db: DebugBridge, msg: string) => {
        //     this.notifyErrorMessage(db, msg);
        // });
    }

    // private onConnected(db: DebugBridge) {
    //     const name = db.getDeviceConfig().name;
    //     const msg = `Connected to ${name}`;
    //     this.notifyProgress(msg);
    //     this.notifyInfoMessage(db, 'Connected');
    // }

    // private onNewState(runtimeState: OldRuntimeState) {
    //     this.viewsRefresher.oldRefreshViews(runtimeState);
    // }

    private onStepCompleted() {
        this.sendEvent(new StoppedEvent('step', this.THREAD_ID));
    }

    private onRunning() {
        this.sendEvent(new ContinuedEvent(this.THREAD_ID));
    }

    private onPause() {
        this.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
    }

    private onException(debugBridge: DebugBridge, runtime: OldRuntimeState) {
        const name = debugBridge.getDeviceConfig().name;
        const exception = runtime.getExceptionMsg();
        const includeMinusOne = false;
        const loc = getLocationForAddress(runtime.getSourceMap(), runtime.getExceptionLocation(), includeMinusOne)?.line ?? -1;
        const msg = `${name}: exception occurred at (Line ${loc}). ${exception}`;
        vscode.window.showErrorMessage(msg);
    }

    private onEnforcingBPPolicy(db: DebugBridge, policy: BreakpointPolicy) {
        const msg = `Enforcing '${policy}' breakpoint policy`;
        this.notifyInfoMessage(db, msg);
    }

    private notifyProgress(msg: string) {
        this.notifier.text = msg;
    }

    private onDisallowedAction(db: DebugBridge, msg: string) {
        const name = db.getDeviceConfig().name;
        const m = `${name}: ${msg}`;
        vscode.window.showErrorMessage(m);
    }

    private notifyInfoMessage(db: DebugBridge, msg: string) {
        const name = db.getDeviceConfig().name;
        const m = `${name}: ${msg}`;
        vscode.window.showInformationMessage(m);
    }

    private notifyErrorMessage(db: DebugBridge, msg: string) {
        const name = db.getDeviceConfig().name;
        const m = `${name}: ${msg}`;
        vscode.window.showErrorMessage(m);
    }
}
