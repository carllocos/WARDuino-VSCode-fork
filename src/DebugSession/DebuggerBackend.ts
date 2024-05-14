import { DeviceManager, SourceCodeLocation, SourceMap, StateRequest, WARDuinoVM, WasmState, Platform, BoardFQBN, BoardBaudRate, VMConfigArgs, WASM, Breakpoint as WasmBreakpoint, OutOfPlaceVM, OutOfThingsMonitor, InputMode, ArduinoBoardBuilder, createArduinoPlatform, PlatformTarget, createDevPlatform, getFileName, equalSourceCodeLocations} from 'wasmito';
import {EventEmitter} from 'events';
import { Context, Events } from '../State/context';
import { DebuggingMode, TargetProgram, UserDeviceConfig, UserEdwardDebuggingConfig, UserMCUConnectionConfig, UserOutOfThingsDebuggingConfig, UserRemoteDebuggingConfig } from '../DebuggerConfig';
import {  Source } from 'vscode-debugadapter';

export class BackendDebuggerEvent {
    public static readonly StateUpdated: string = 'state updated';
    public static readonly BreakpointReached: string = 'breakpoint reached';
    public static readonly NewEventArrived: string = 'New Event arrived';
    public static readonly EventHandled: string = 'Event hanlded';
    // public static readonly moduleUpdated: string = 'module updated';
    // public static readonly stepCompleted: string = 'stepped';
    // public static readonly running: string = 'running';
    // public static readonly paused: string = 'paused';
    // public static readonly exceptionOccurred: string = 'exception occurred';
    // public static readonly enforcingBreakpointPolicy: string = 'enforcing breakpoint policy';
    // public static readonly connected: string = 'connected';
    // public static readonly connectionError: string = 'connectionError';
    // public static readonly disconnected: string = 'disconnected';
    // public static readonly emulatorStarted: string = 'emulator started';
    // public static readonly emulatorClosed: string = 'emulator closed';
    // public static readonly progress: string = 'progress';
    // public static readonly errorInProgress: string = 'progress error';
    // public static readonly compiling: string = 'Compiling the code';
    // public static readonly compiled: string = 'Compiled Code';
    // public static readonly compilationFailure: string = 'Compilation failure';
    // public static readonly flashing: string = 'Flashing Code';
    // public static readonly flashingFailure: string = 'Flashing failed';
}

export class BreakpointBackend  {
    private readonly _bp: WasmBreakpoint;
    private readonly _source: Source;
    constructor(bp: WasmBreakpoint, source: Source){
        this._bp = bp;
        this._source = source;
    }

    get linenr(): number{
        return this.bp.sourceCodeLocation.linenr;
    }

    get sourceCodeLocation(): SourceCodeLocation {
        return this.bp.sourceCodeLocation;
    }

    get bp(): WasmBreakpoint {
        return this._bp;
    }

    get source(): Source {
        return this._source;
    }


    equals(otherBP: BreakpointBackend): boolean {
        return this.bp.equals(otherBP.bp);
    }
}


export enum RunningState {
    paused,
    running
}


export interface DbgOptArgs {
    initialContext?: Context
    initialRunningState?: RunningState
    isOutOfThingsDebugger?: boolean
}

export class RemoteDebuggerBackend extends EventEmitter {

    public readonly targetVM: WARDuinoVM;
    public readonly debuggingMode: DebuggingMode;
    private context: Context;

    private _breakpoints: BreakpointBackend[];

    private _monitor?: OutOfThingsMonitor;
    private _runningState: RunningState;
    private _isOutOfThingsDBG: boolean;

    constructor(vm: WARDuinoVM, debuggingMode: DebuggingMode, opts?: DbgOptArgs){
        super();
        this.targetVM = vm;
        this.debuggingMode = debuggingMode;
        this.context = opts?.initialContext ?? new Context(new WasmState({}), this.targetVM.sourceMap);
        this._breakpoints = [];
        this._runningState = opts?.initialRunningState ?? RunningState.paused;
        this._isOutOfThingsDBG = opts?.isOutOfThingsDebugger ?? false;
    }


    get breakpoints(): BreakpointBackend[] {
        return this._breakpoints;
    }

    set breakpoints(bps: BreakpointBackend[]) {
        this._breakpoints = bps;
    }
    
    eventsToHandle(): WASM.Event[] {
        if(this.targetVM instanceof OutOfPlaceVM){
            return this.targetVM.eventsToHandle;
        }
        return [];
    }

    isOOTDBG(): boolean {
        return this._isOutOfThingsDBG;
    }

    isPaused(): boolean{
        return this._runningState === RunningState.paused;
    }

    hasOOTMonitor(): boolean{
        return this._monitor !== undefined;
    }

    get monitor(): OutOfThingsMonitor {
        if(this._monitor === undefined){
            throw new Error('monitor was not set');
        }
        return this._monitor;
    }


    async handleEvent(eventIndex: number): Promise<void>{
        // manually handling event is only for OutOfPlace debugging
        if(!(this.targetVM instanceof OutOfPlaceVM) || this.targetVM.eventsToHandle.length === 0){
            return;
        }

        const ev = this.targetVM.eventsToHandle[0];
        const handled = await this.targetVM.handleEvent(eventIndex);
        if(!handled){
            throw Error('Event could not be handled');
        }
        
        this.emit(BackendDebuggerEvent.EventHandled, ev, this.targetVM.eventsToHandle);
    }

    async setMonitor(monitor: OutOfThingsMonitor): Promise<void>{
        this._monitor = monitor;
        await monitor.setup();
    }

    close(): Promise<boolean> {
        return this.targetVM.close();
    }

    connect(timeout?: number): Promise<boolean> {
        return this.targetVM.connect(timeout);
    }

    disconnect(): Promise<boolean> {
        return this.targetVM.disconnect();
    }

    async run(timeout?: number): Promise<boolean> {
        const running =  await this.targetVM.run(timeout);
        if(running){
            this._runningState = RunningState.running;
        }
        return running;
    }

    async pause(timeout?: number): Promise<void> {
        await this.targetVM.pause(timeout);
        this._runningState = RunningState.paused;
    }

    async stepOver(timeout?: number): Promise<void> {
        const sl = this.context.getCurrentSourceCodeLocation();
        if(sl === undefined){
            return await this.step(timeout);
        }
        return await this.step(timeout);
        // const locations = this.targetVM.sourceMap.nextSourceCodeLocation(sl.source, sl.linenr, sl.columnStart);
        // if(locations.length === 0){
        //     return await this.step(timeout);
        // }
        // if(locations.length > 1){
        //     throw new Error('Handle multiple locations');
        // }

        // const sm = locations[0];
        // const pauseHook = new PauseVMHook().scheduleOnce();
        // const added = await this.targetVM.addHookBefore({
        //     linenr: sm.linenr,
        //     columnStart: sm.columnStart
        // }, pauseHook);
        // if(!added){
        //     throw new Error(`Failed to add pauseHook on linenr=${sm.linenr} and colStart=${sm.columnStart}`);
        // }

        // const sreq = new StateRequest();
        // sreq.includePC();
        // const stateHook = new InspectStateHook(sreq);
        // stateHook.scheduleOnce();
        // const addedStateHook = await this.targetVM.addHookBefore({
        //     linenr: sm.linenr,
        //     columnStart: sm.columnStart
        // }, stateHook);
        // if(!addedStateHook){
        //     throw new Error(`Failed to add pauseHook on linenr=${sm.linenr} and colStart=${sm.columnStart}`);
        // }
        // return new Promise((res, rej)=>{
        //     stateHook.subscribe((s: WasmState)=>{
        //         this.refreshState().then(res).catch(rej);
        //     });
        //     this.targetVM.run(timeout).catch(rej);
        // });
    }

    async step(timeout?: number): Promise<void> {
        await this.targetVM.step(timeout);
        await this.refreshState();
        return;
    }

    uploadSourceCode(
        sourceCodePath: string,
        timeout?: number,
    ): Promise<boolean> {
        return this.targetVM.uploadSourceCode(sourceCodePath, timeout);
    }

    proxify(timeout?: number): Promise<void> {
        return this.targetVM.proxify(timeout);
    }

    getSourceMap(): SourceMap {
        return this.targetVM.sourceMap;
    }


    private onBreakpointReached(state: WasmState): void {
        const sourceMap = this.targetVM.sourceMap;
        this.context =  new Context(state, sourceMap);
        this.emit(BackendDebuggerEvent.BreakpointReached, this.context, this.context.getCurrentSourceCodeLocation()!);
    }


    public onNewEvent(ev: WASM.Event): void {
        let allEvents: WASM.Event[] = this.context.events.values;
        if( this.targetVM instanceof OutOfPlaceVM){
            allEvents = this.targetVM.eventsToHandle;
        }else{
            allEvents.push(ev);
        }
        this.emit(BackendDebuggerEvent.NewEventArrived, ev, allEvents);
    }

    private async addBreakpoint(sourceCodeLocation: SourceCodeLocation): Promise<boolean>{
        const bp = new WasmBreakpoint(sourceCodeLocation);
        bp.subscribe(this.onBreakpointReached.bind(this));
        if(!await this.targetVM.addBreakpoint(bp)){
            return false;
        }

        const source = new Source(getFileName(sourceCodeLocation.source), sourceCodeLocation.source);
        this.breakpoints.push(new BreakpointBackend(bp, source));
        return true;
    }

    private async removeBreakpoint(sourceCodeLocation: SourceCodeLocation, timeout?: number): Promise<boolean> {
        let bpPosition = -1;
        const bpToRemove = new WasmBreakpoint(sourceCodeLocation);

        const bp = this.breakpoints.find((bp, idx) =>{
            bpPosition = idx;
            return bp.bp.equals(bpToRemove);
        });

        if(bp === undefined){
            return true;
        }
        const success =  await this.targetVM.removeBreakpoint(bp.bp, timeout);
        if(success){
            this.breakpoints.splice(bpPosition, 1);
        }
        return success;
    }

    private stateToRequest(): StateRequest {
        return new StateRequest().includePC().includeStack()
            .includeCallstack()
            .includeGlobals()
            .includeEvents();
    }

    async refreshState(): Promise<void> {
        const state = this.stateToRequest();
        const response: WasmState = await this.targetVM.sendRequest(state);
        const sourceMap = this.getSourceMap();
        this.context =  new Context(response, sourceMap);
        if(this.targetVM instanceof OutOfPlaceVM){
            this.context.events = new Events(this.targetVM.eventsToHandle, this.getSourceMap());
        }
        this.emit(BackendDebuggerEvent.StateUpdated, this.context);
    }


    getCurrentContext(): Context {
        return this.context;
    }

    async setBreakPoints(bpsToSet: SourceCodeLocation[]): Promise<boolean> {

        // Find breakpoints that need to be removed 
        const bpsToDelete:SourceCodeLocation[]  = [];
        for(let bp of this.breakpoints){
            const found = bpsToSet.find((b)=>{
                return equalSourceCodeLocations(b, bp.sourceCodeLocation);
            });
            if(found === undefined){
                bpsToDelete.push(bp.sourceCodeLocation);
            }
        }
        const deletedReplies: boolean[] = [];
        for (let i = 0; i < bpsToDelete.length; i++) {
            deletedReplies.push(await this.removeBreakpoint(bpsToDelete[i]));
        }
        const allDeleted = deletedReplies.reduce((acc: boolean, v: boolean) => acc && v, true);
        if(!allDeleted){
            return false;
        }

        // Keep breakpoints that need to be added
        const bpsToAdd: SourceCodeLocation[]=[];
        for (let i = 0; i < bpsToSet.length; i++) {
            const found = this.breakpoints.find((b)=>{
                return equalSourceCodeLocations(b.sourceCodeLocation, bpsToSet[i]);
            });
            if(found === undefined){
                bpsToAdd.push(bpsToSet[i]);
            }
        }
        const addedReplies: boolean[] = [];
        for (let i = 0; i < bpsToAdd.length; i++) {
            addedReplies.push(await this.addBreakpoint(bpsToAdd[i]));
        }
        const allAdded = addedReplies.reduce((acc: boolean, v: boolean) => acc && v, true);
        return allAdded;
    }
}

export async function createTargetVM(deviceManager: DeviceManager, platformTarget: PlatformTarget,  deploy: boolean, targetProgram: TargetProgram,  existingToolPort: number | undefined, mcuConfig: UserMCUConnectionConfig | undefined, pauseOnDeploy: boolean): Promise<WARDuinoVM> 
{
    if(platformTarget === PlatformTarget.DevVM){
        const platform = await createDevPlatform({
            selectedLanguage: {
                targetLanguage: targetProgram.targetLanguage,
            },
            vmConfig: {
                toolPort: existingToolPort,
                pauseOnStart: pauseOnDeploy
            }
        });
        if(deploy){
            return await deviceManager.spawnDevelopmentVM(platform, targetProgram.program);
        } else if(existingToolPort === undefined){
            throw new Error('existingToolPort is mandatory when connecting to an already deployed DevVM');
        }
        else{
            return await deviceManager.connectToExistingDevVM(platform, targetProgram.program, 3000);
        }
    }
    else{
        if(mcuConfig === undefined){
            throw new Error('MCU config is mandatory when targetting mcu');
        }
        const platform = await createArduinoPlatform({
            selectedLanguage: {
                targetLanguage: targetProgram.targetLanguage,
            },
            vmConfig: {
                fqbn: {
                    fqbn: mcuConfig.fqbn,
                    boardName: mcuConfig.boardName ?? '',
                },
                serialPort: mcuConfig.serialPort,
                baudrate: mcuConfig.baudrate,
                pauseOnStart: pauseOnDeploy,
            },
        });
        if(deploy){
            return await deviceManager.spawnHardwareVM(platform, targetProgram.program);
        } else{
            return await deviceManager.connectToExistingMCUVM(platform, targetProgram.program);
        }
    }
}


export async function setupForEdwardDebugging(devicesManager: DeviceManager, config: UserEdwardDebuggingConfig): Promise<RemoteDebuggerBackend>{
    const pauseOnDeploy = true;
    const targetVM = await createTargetVM(devicesManager, config.target, !!config.deployOnStart, config.program, config.toolPortExistingVM, config.mcuConfig, pauseOnDeploy);
    let ooVM: OutOfPlaceVM | undefined;
    if(config.toolPortExistingVM){
        ooVM =  await devicesManager.setupAlreadySpawnedVMForOutOfPlaceVM(config.toolPortExistingVM, targetVM, config.serverPortForProxyCall, 10000);
    }else{
        ooVM = await devicesManager.spawnOutOfPlaceVM(targetVM, InputMode.RedirectInput);
    }
    const dbg = new RemoteDebuggerBackend(ooVM, DebuggingMode.edward);
    if(!(await ooVM.subscribeOnNewEvent((ev)=>{
        dbg.onNewEvent(ev);}))) {
        throw new Error('Could not subscribe to on New IO Event');
    }
    return dbg;
}


async function setupForOutOfThingsDebugging(devicesManager:DeviceManager, config: UserOutOfThingsDebuggingConfig): Promise<RemoteDebuggerBackend> {
    const pauseOnDeploy = config.pauseOnDeploy ?? true;
    const targetVM = await createTargetVM(devicesManager, config.target, !!config.deployOnStart, config.programOnTarget, config.toolPortExistingVM, config.mcuConfig, pauseOnDeploy);
    const monitor = devicesManager.createOutOfThingsMonitor(targetVM);
    const dbg = new RemoteDebuggerBackend(targetVM, DebuggingMode.outOfThings, {
        initialRunningState: RunningState.paused
    });
    await dbg.setMonitor(monitor);
    return dbg;
}

async function setupForRemoteDebugging(devicesManager:DeviceManager, config: UserRemoteDebuggingConfig): Promise<RemoteDebuggerBackend> {
    const pauseOnDeploy = true;
    const targetVM = await createTargetVM(devicesManager, config.target, !!config.deployOnStart, config.program, config.toolPortExistingVM, config.mcuConfig, pauseOnDeploy);
    const dbg= new RemoteDebuggerBackend(targetVM, DebuggingMode.remoteDebugging);
    if(!await targetVM.subscribeOnNewEvent(dbg.onNewEvent.bind(dbg))){
        throw new Error('Could not subscribe to on New IO Event');
    }
    return dbg;
}



export async function createDebuggerBackend(devicesManager: DeviceManager, userConfig: UserDeviceConfig): Promise<RemoteDebuggerBackend> {
    if(userConfig.debuggingMode === DebuggingMode.remoteDebugging){
        if(userConfig.remoteDebuggingConfig === undefined){
            throw new Error('remoteDebuggingConfig is missing');
        }
        return await setupForRemoteDebugging(devicesManager, userConfig.remoteDebuggingConfig);
    }
    else if(userConfig.debuggingMode === DebuggingMode.edward){
        if(userConfig.edwardDebuggingConfig  === undefined){
            throw new Error('edwardDebuggingConfig is missing');
        }
        return await setupForEdwardDebugging(devicesManager, userConfig.edwardDebuggingConfig);
    }
    else if(userConfig.debuggingMode === DebuggingMode.outOfThings){
        if(userConfig.outOfThingsConfig  === undefined){
            throw new Error('outOfThingsConfig is missing');
        }
        return await setupForOutOfThingsDebugging(devicesManager, userConfig.outOfThingsConfig);
    }
    else {
        throw new Error(`unsupported debugging mode ${userConfig.debuggingMode}`);
    }
}