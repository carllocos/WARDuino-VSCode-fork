import { RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { OldRuntimeState } from '../State/RuntimeState';
import { Context} from '../State/context';

export interface RuntimeViewRefreshInterface {

    setCurrentDBG(dbg: RemoteDebuggerBackend): void;
    oldRefreshView(runtimeState?: OldRuntimeState): void;
    refreshView(runtimeState?: Context): void;

}