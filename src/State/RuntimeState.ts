import { EventItem } from "../Views/EventsProvider";
import { Frame } from "../Parsers/Frame";
import { VariableInfo } from "./VariableInfo";
import { WasmState } from "./AllState";
import { SourceMap } from "./SourceMap";
import { InterruptEvent } from "./WOODState";

function hash(s: string) {
    let h: number = 0;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return h;
}

export class RuntimeState {
    private id: number = 0;
    private programCounter: number = 0;
    public startAddress: number = 0;
    public callstack: Frame[] = [];
    public locals: VariableInfo[] = [];
    public events: EventItem[] = [];
    public stack: VariableInfo[] = [];
    public globals: VariableInfo[] = [];
    public arguments: VariableInfo[] = [];
    public pcerror: number = -1;
    public exception_msg: string = "";

    public wasmState: WasmState;

    private source: string = "";
    private sourceMap: SourceMap;


    constructor(source: string, sourceMap: SourceMap) {
        this.id = hash(source ?? "");
        this.sourceMap = sourceMap;
        this.source = source;
        this.wasmState = WasmState.fromLine(source, sourceMap);
        this.fillState();
    }

    public getId(): number {
        return this.id;
    }

    public getExceptionMsg(): string {
        return `Exception occurred on device: ${this.exception_msg}`;
    }

    public getRawProgramCounter(): number {
        return this.programCounter;
    }

    public getArguments() {
        this.arguments;
    }

    public setRawProgramCounter(raw: number) {
        this.programCounter = raw;
    }

    public getAdjustedProgramCounter(): number {
        return this.programCounter - this.startAddress;
    }

    public currentFunction(): number {
        if (this.callstack.length === 0) {
            return -1;
        }
        return this.callstack[this.callstack.length - 1].index;
    }

    public deepcopy(): RuntimeState {
        const copy = new RuntimeState(this.source, this.sourceMap);
        copy.id = this.id;
        copy.programCounter = this.programCounter;
        copy.startAddress = this.startAddress;
        copy.callstack = this.callstack.map(obj => Object.assign({}, obj));
        copy.locals = this.locals.map(obj => Object.assign({}, obj));
        copy.arguments = this.arguments.map(obj => Object.assign({}, obj));
        copy.events = this.events.map(obj => Object.assign({}, obj));
        copy.globals = this.globals.map(obj => Object.assign({}, obj));
        copy.stack = this.stack.map(obj => Object.assign({}, obj));
        copy.wasmState = this.wasmState;
        copy.pcerror = this.pcerror;
        copy.exception_msg = this.exception_msg;
        return copy;
    }

    public updateLocal(name: string, value: string): VariableInfo | undefined {
        const newValue = parseInt(value);
        if (isNaN(newValue)) {
            return undefined;
        }
        const local = this.locals.find(l => l.name === name);
        if (!!local) {
            this.wasmState?.updateStackValue(local.index, newValue);
            local.value = newValue.toString();
            return local;
        }
        return undefined;
    }

    public getLocal(name: string) {
        return this.locals.find(l => l.name === name);
    }

    public updateArgument(name: string, value: string): VariableInfo | undefined {
        const newValue = parseInt(value);
        if (isNaN(newValue)) {
            return undefined;
        }
        const arg = this.arguments.find(l => l.name === name);
        if (!!arg) {
            this.wasmState?.updateStackValue(arg.index, newValue);
            arg.value = newValue.toString();
            return arg;
        }
        return undefined;
    }

    public getArgument(name: string) {
        return this.arguments.find(l => l.name === name);
    }

    public updateGlobal(name: string, value: string): VariableInfo | undefined {
        const newValue = parseInt(value);
        if (isNaN(newValue)) {
            return;
        }
        const global = this.globals.find(g => g.name === name);
        if (!!global) {
            this.wasmState?.updateGlobalValue(global.index, newValue);
            global.value = newValue.toString();
            return global;
        }
        return undefined;
    }

    public getGlobal(name: string) {
        return this.globals.find(g => g.name === name);
    }

    private fillState() {
        this.startAddress = 0;
        this.setRawProgramCounter(this.wasmState.getPC());
        this.callstack = this.wasmState.getCallStack().map(frame => {
            return { index: Number(frame.fidx), returnAddress: frame.ra };
        });
        this.stack = this.wasmState.getStack();
        this.locals = this.wasmState.getLocals();
        this.globals = this.wasmState.getGlobals();
        this.arguments = this.wasmState.getArguments();
        this.events = this.wasmState.getEvents().map((ev: InterruptEvent) => {
            return new EventItem(ev.topic, ev.payload);
        });
        if (this.hasException()) {
            this.pcerror = this.wasmState.getPCError();
            this.exception_msg = this.wasmState.getExceptionMsg();
            if (!this.oldException()) {
                this.programCounter = this.pcerror;
            }
        }
    }

    public setEvents(events: EventItem[]): void {
        this.events = events;
    }

    public hasException(): boolean {
        return this.wasmState.hasException();
    }

    private oldException(): boolean {
        return false;
    }
}
