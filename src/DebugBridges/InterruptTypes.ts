export enum InterruptTypes {
    interruptRUN = '01',
    interruptHALT = '02',
    interruptPAUSE = '03',
    interruptSTEP = '04',
    interruptBPAdd = '06',
    interruptBPRem = '07',
    interruptDUMP = '10',
    interruptDUMPLocals = '11',
    interruptDUMPFull = '12',
    interruptUPDATEFun = '20',
    interruptWOODDump = '60',
    interruptOffset = '61',
    interruptWOODRecvState = '62' // WOOD Change state
}