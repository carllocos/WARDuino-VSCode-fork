import {DebugBridge} from "./DebugBridge";
import {Frame} from "../Parsers/Frame";
import {VariableInfo} from "../CompilerBridges/VariableInfo";
import {SourceMap} from "../CompilerBridges/SourceMap";
import {DebugBridgeListener} from "./DebugBridgeListener";

export class Messages {
    public static UPLOADING: string = "Uploading to board";
    public static CONNECTING: string = "Connecting to board";
    public static CONNECTED: string = "Connected to board";
    public static DISCONNECTED: string = "Disconnected board";

    public static COMPILING: string = "Compiling the code";
    public static COMPILED: string = "Compiled Code";
    public static RESET: string = "Press reset button";

    public static ERROR: string = "Failed to initialise";
}

export abstract class AbstractDebugBridge implements DebugBridge {
    protected sourceMap: SourceMap | void;
    protected listener: DebugBridgeListener;
    protected pc: number = 0;
    protected callstack: Frame[] = [];

    protected constructor(sourceMap: SourceMap | void, listener: DebugBridgeListener) {
        this.sourceMap = sourceMap;
        this.listener = listener;
    }

    abstract connect(): Promise<string>;

    abstract disconnect(): void;

    abstract getCurrentFunctionIndex(): number;

    abstract pause(): void;

    abstract pullSession(): void;

    abstract refresh(): void;

    abstract run(): void;

    abstract setBreakPoint(x: number): void;

    abstract setStartAddress(startAddress: number): void;

    abstract setVariable(name: string, value: number): Promise<string>;

    abstract step(): void;

    abstract upload(): void;

    getProgramCounter(): number {
        return this.pc;
    }

    setProgramCounter(pc: number) {
        this.pc = pc;
    }

    getLocals(fidx: number): VariableInfo[] {
        if (this.sourceMap === undefined || fidx >= this.sourceMap.functionInfos.length || fidx < 0) {
            return [];
        }
        return this.sourceMap.functionInfos[fidx].locals;
    }

    setLocals(fidx: number, locals: VariableInfo[]) {
        if (this.sourceMap === undefined) {
            return;
        }
        if (fidx >= this.sourceMap.functionInfos.length) {
            console.log(`warning setting locals for new function with index: ${fidx}`);
            this.sourceMap.functionInfos[fidx] = {index: fidx, name: "<anonymous>", locals: []};
        }
        this.sourceMap.functionInfos[fidx].locals = locals;
    }

    getCallstack(): Frame[] {
        return this.callstack;
    }

    setCallstack(callstack: Frame[]): void {
        this.callstack = callstack;
        this.listener.notifyStateUpdate();
    }
}