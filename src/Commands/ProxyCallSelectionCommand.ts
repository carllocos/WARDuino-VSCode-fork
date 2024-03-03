import { ProxyCallItem } from '../Views/ProxyCallsProvider';

export async function toggleProxyCall(resource: ProxyCallItem) {
    if(resource.isSelected()){
        // await resource.dbg.targetVM.unRegisterFuncForProxyCall(resource.func);
        console.error('TODO implement unregisterProxyCall');
    }
    else{
        await resource.dbg.targetVM.registerFuncForProxyCall(resource.func);
    }
    resource.provider.refreshView();
}