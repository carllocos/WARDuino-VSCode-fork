import { InputMode, OutOfThingsSpawnConfig } from 'wasmito';
import { OutOfThingsSessionItem } from '../Views/OutOfThingsSessionProvider';
import { ViewsManager } from '../Views/ViewsManager';
import { DbgOptArgs, RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { DebuggingMode } from '../DebuggerConfig';

export async function startOutOfThingsDebuggingWithDevVMCommand(viewManager: ViewsManager, resource: OutOfThingsSessionItem): Promise<void>{
    const config: OutOfThingsSpawnConfig = {
        targetInputMode: InputMode.CopyInput,
        maxWaitTime: 10000,
    };
    const vm =  await resource.monitor.spawnDevVM(resource.index, config);
    const opts: DbgOptArgs = {
        initialContext: resource.snapshot,
        isOutOfThingsDebugger: true,
    };
    const dbg = new RemoteDebuggerBackend(vm, DebuggingMode.outOfThings, opts);
    viewManager.createViews(dbg);
};