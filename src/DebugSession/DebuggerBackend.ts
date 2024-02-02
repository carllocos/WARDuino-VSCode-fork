import { DeviceManager, DeploymentMode, SourceCodeLocation, SourceMap, StateRequest, WARDuinoVM, WasmState, PlatformBuilderConfig, Platform, BoardFQBN, DeviceConfigArgs, BoardBaudRate, VMConfigArgs, listAvailableBoards, WASM } from 'wasmito';
import {EventEmitter} from 'events';
import { Context } from '../State/context';
import { DebuggingMode, UserConfig, createVMConfig as createVMConfigArgs} from '../DebuggerConfig';
import { Breakpoint, Source } from 'vscode-debugadapter';
import { OutOfPlaceVM } from 'wasmito/dist/types/src/warduino/vm/outofplace_vm';

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

export class BreakpointBackend extends Breakpoint {
    public readonly linenr: number;
    constructor(linenr: number, columnStart?: number, source?: Source){
        super(true, linenr, columnStart, source);
        this.linenr = linenr;
    }
}

export class RemoteDebuggerBackend extends EventEmitter {

    private readonly vm: WARDuinoVM;
    private context: Context;

    // private _breakpoints: BreakpointBackend[];

    constructor(vm: WARDuinoVM){
        super();
        this.vm = vm;
        this.context = new Context(new WasmState({}), this.vm.getSourceMap()!);
        // this._breakpoints = [];
    }


    get breakpoints(): BreakpointBackend[] {
        return this.vm.breakpoints.map((loc)=>{
            return this.makeBreakpoint(loc);
        });
    }

    async handleEvent(eventIndex: number): Promise<void>{
        const vm = this.vm as OutOfPlaceVM;
        if(vm.eventsToHandle.length===0){
            return;
        }
        const ev = vm.eventsToHandle[0];
        const handled = await vm.handleEvent(eventIndex);
        if(!handled){
            throw Error('Event could not be handled');
        }
        
        this.emit(BackendDebuggerEvent.EventHandled, ev, vm.eventsToHandle);
    }

    close(): Promise<boolean> {
        return this.vm.close();
    }

    connect(timeout?: number): Promise<boolean> {
        return this.vm.connect(timeout);
    }

    disconnect(): Promise<boolean> {
        return this.vm.disconnect();
    }

    run(timeout?: number): Promise<boolean> {
        return this.vm.run(timeout);
    }

    pause(timeout?: number): Promise<void> {
        return this.vm.pause(timeout);
    }

    async step(timeout?: number): Promise<void> {
        await this.vm.step(timeout);
        await this.refreshState();
        return;
    }

    uploadSourceCode(
        sourceCodePath: string,
        timeout?: number,
    ): Promise<boolean> {
        return this.vm.uploadSourceCode(sourceCodePath, timeout);
    }

    proxify(timeout?: number): Promise<void> {
        return this.vm.proxify(timeout);
    }

    getSourceMap(): SourceMap | undefined {
        return this.vm.getSourceMap();
    }

    private makeBreakpoint(sourceCodeLocation: SourceCodeLocation): BreakpointBackend {
        const sm = this.getSourceMap();
        if(sm === undefined){
            throw new Error('No sourcemap found');
        }
        const source = new Source(sm.sourceCodeFileName, sm.sourceCodeFilePath);
        return new BreakpointBackend(sourceCodeLocation.linenr, sourceCodeLocation.columnStart, source);
    }


    private onBreakpointReached(state: WasmState): void {
        const sourceMap = this.getSourceMap()!;
        this.context =  new Context(state, sourceMap);
        this.emit(BackendDebuggerEvent.BreakpointReached, this.context, this.context.getCurrentSourceCodeLocation()!);
    }


    public onNewEvent(ev: WASM.Event, allEvents: WASM.Event[]): void {
        this.emit(BackendDebuggerEvent.NewEventArrived, ev, allEvents);
    }

    private async addBreakpoint(sourceCodeLocation: SourceCodeLocation): Promise<boolean>{
        const stateOnBp = this.stateToRequest();
        if(!await this.vm.addBreakpoint(sourceCodeLocation,stateOnBp, this.onBreakpointReached.bind(this))){
            return false;
        }
        const bp = this.makeBreakpoint(sourceCodeLocation);
        // this.breakpoints.push(bp);
        return true;
    }

    private async removeBreakpoint(sourceCodeLocation: SourceCodeLocation, timeout?: number): Promise<boolean> {
        return await this.vm.removeBreakpoint(sourceCodeLocation, timeout);
    }

    private stateToRequest(): StateRequest {
        return new StateRequest().includePC().includeStack()
            .includeCallstack()
            .includeGlobals()
            .includeEvents();
    }

    async refreshState(): Promise<void> {
        const state = this.stateToRequest();
        const response: WasmState = await this.vm.sendRequest(state);
        const sourceMap = this.vm.getSourceMap();
        if(sourceMap === undefined){
            throw new Error('Sourcemap is undefined');
        }
        this.context =  new Context(response, sourceMap);
        const vm = this.vm as OutOfPlaceVM;
        this.context.events = vm.eventsToHandle;
        this.emit(BackendDebuggerEvent.StateUpdated, this.context);
    }


    getCurrentContext(): Context | undefined {
        return this.context;
    }

    async setBreakPoints(bpsToSet: number[]): Promise<boolean> {

        // Delete removed breakpoints
        const bpsToDelete = this.breakpoints
            .filter(bp => !bpsToSet.includes(bp.linenr));
        const deletedReplies: boolean[] = [];
        for (let i = 0; i < bpsToDelete.length; i++) {
            deletedReplies.push(await this.removeBreakpoint({
                linenr: bpsToDelete[i].linenr}));
        }
        const allDeleted = deletedReplies.reduce((acc: boolean, v: boolean) => acc && v, true);
        if(!allDeleted){
            return false;
        }

        // Keep breakpoints that need to be added

        const bpsToAdd = bpsToSet.filter(linenr =>{
            return this.breakpoints.find(bp => bp.linenr === linenr) === undefined;
        });
        const addedReplies: boolean[] = [];
        for (let i = 0; i < bpsToAdd.length; i++) {
            addedReplies.push(await this.addBreakpoint({
                linenr: bpsToAdd[i]}));
        }
        const allAdded = addedReplies.reduce((acc: boolean, v: boolean) => acc && v, true);
        return allAdded;
    }
}

async function createPlatformConfig(config: UserConfig, vmConfigArgs: VMConfigArgs): Promise<PlatformBuilderConfig>{

    const deviceConfigArgs: DeviceConfigArgs = {
        // TODO handle name giving in toolkit
        name: config.boardName as string,
        deploymentMode: config.target
    };
    const boardFQN: BoardFQBN = {
        fqbn: config.fqbn as string,
        boardName: config.boardName as string
    };
    return new PlatformBuilderConfig(Platform.Arduino, config.baudrate as BoardBaudRate, boardFQN, deviceConfigArgs, vmConfigArgs);
}

export async function createTargetVM(deviceManager: DeviceManager, userConfig: UserConfig): Promise<WARDuinoVM>{
    const vmConfigArgs = createVMConfigArgs(userConfig);
    if(userConfig.target === DeploymentMode.DevVM){
        const maxWaitTime = 3000;
        const vm = await deviceManager.spawnDevelopmentVM(vmConfigArgs, maxWaitTime);
        return vm;
    }
    else if(userConfig.target === DeploymentMode.MCUVM){
        const platformConfig = await createPlatformConfig(userConfig, vmConfigArgs);
        const vm = await deviceManager.spawnHardwareVM(platformConfig);
        const uploaded = await vm.uploadSourceCode(vmConfigArgs.program);
        if(!uploaded){
            throw new Error(`failed to upload source code ${vmConfigArgs.program}`);
        }
        return vm;
    }
    else {
        throw new Error(`TODO: Unsupported Deployment mode ${userConfig.target}`);
    }
}

export async function createDebuggerBackend(devicesManager: DeviceManager, userConfig: UserConfig): Promise<RemoteDebuggerBackend> {
    const targetVM = await createTargetVM(devicesManager, userConfig);
    if(userConfig.debuggingMode === DebuggingMode.remoteDebugging){
        return new RemoteDebuggerBackend(targetVM);
    }
    else if(userConfig.debuggingMode === DebuggingMode.edward){
        let ooVM: OutOfPlaceVM | undefined;
        if(userConfig.existingVM !== undefined && userConfig.existingVM && userConfig.toolPortExistingVM !== undefined){
            ooVM =  await devicesManager.existingVMAsOutOfPlaceVM(userConfig.toolPortExistingVM, targetVM, userConfig.serverPortForProxyCall, 10000);
        }else{
            ooVM = await devicesManager.spawnOutOfPlaceVM(targetVM);
        }
        const dbg = new RemoteDebuggerBackend(ooVM);

        // TODO tmp solution as soon one backend will be there per different target VM
        ooVM.subscribeOnNewEvent((ev: WASM.Event)=>{
            dbg.onNewEvent(ev, ooVM.eventsToHandle);
        });

        return dbg;
    }
    else {
        throw new Error(`unsupported debugging mode ${userConfig.debuggingMode}`);
    }
}
