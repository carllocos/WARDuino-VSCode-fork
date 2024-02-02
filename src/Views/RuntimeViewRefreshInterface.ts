import { OldRuntimeState } from '../State/RuntimeState';
import { Context} from '../State/context';

export interface RuntimeViewRefreshInterface {

    oldRefreshView(runtimeState?: OldRuntimeState): void;
    refreshView(runtimeState?: Context): void;

}