import decodeUTF8 from '../decodeUTF8';

let le = (function() {
    let buf = new ArrayBuffer(2);
    (new DataView(buf)).setInt16(0, 256, true); // little-endian write
    return (new Int16Array(buf))[0] === 256; // platform-spec read, if equal then LE
})();
export default class flvDemux {

    constructor() {

    }
    static parseObject(arrayBuffer, dataOffset, dataSize) {

        let name = flvDemux.parseString(arrayBuffer, dataOffset, dataSize);
        let value = flvDemux.parseScript(arrayBuffer, dataOffset + name.size);
        let isObjectEnd = value.objectEnd;

        return {
            data: {
                name: name.data,
                value: value.data
            },
            size: value.size,
            objectEnd: isObjectEnd
        };
    }

    static parseVariable(arrayBuffer, dataOffset, dataSize) {
        return flvDemux.parseObject(arrayBuffer, dataOffset, dataSize);
    }
    static parseLongString(arrayBuffer, dataOffset, dataSize) {
        if (dataSize < 4) {
            throw new IllegalStateException('Data not enough when parse LongString');
        }
        let v = new DataView(arrayBuffer, dataOffset);
        let length = v.getUint32(0, !le);

        let str;
        if (length > 0) {
            str = decodeUTF8(new Uint8Array(arrayBuffer, dataOffset + 4, length));
        } else {
            str = '';
        }

        return {
            data: str,
            size: 4 + length
        };
    }
    static parseDate(arrayBuffer, dataOffset, dataSize) {
        if (dataSize < 10) {
            throw new IllegalStateException('Data size invalid when parse Date');
        }
        let v = new DataView(arrayBuffer, dataOffset);
        let timestamp = v.getFloat64(0, !le);
        let localTimeOffset = v.getInt16(8, !le);
        timestamp += localTimeOffset * 60 * 1000; // get UTC time

        return {
            data: new Date(timestamp),
            size: 8 + 2
        };
    }
    static parseString(arrayBuffer, dataOffset, dataSize) {
        let v = new DataView(arrayBuffer, dataOffset);
        let length = v.getUint16(0, !le);
        let str;
        if (length > 0) {
            str = decodeUTF8(new Uint8Array(arrayBuffer, dataOffset + 2, length));
        } else {
            str = '';
        }
        return {
            data: str,
            size: 2 + length
        };
    }

    /**
     * 解析metadata
     */
    static parseMetadata(arr) {
        let name = flvDemux.parseScript(arr, 0);
        let value = flvDemux.parseScript(arr, name.size, arr.length - name.size);
        // return {}
        let data = {};
        data[name.data] = value.data;
        return data;
    }




    static parseScript(arr, offset, dataSize) {
        let dataOffset = offset;
        let object = {};
        let uint8 = new Uint8Array(arr);
        let buffer = uint8.buffer;
        let dv = new DataView(buffer, 0, dataSize);
        let value = null;

        let type = (dv.getUint8(dataOffset));
        dataOffset += 1;
        switch (type) {
            case 0: // Number(Double) type
                value = dv.getFloat64(dataOffset, !le);
                dataOffset += 8;
                break;
            case 1:
                { // Boolean type
                    let b = dv.getUint8(dataOffset);
                    value = b ? true : false;
                    dataOffset += 1;
                    break;
                }
            case 2:
                { // String type
                    // dataOffset += 1;
                    let amfstr = flvDemux.parseString(buffer, dataOffset);
                    value = amfstr.data;
                    dataOffset += amfstr.size;
                    break;
                }
            case 3:

                { // Object(s) type
                    value = {};
                    let terminal = 0; // workaround for malformed Objects which has missing ScriptDataObjectEnd
                    if ((dv.getUint32(dataSize - 4, !le) & 0x00FFFFFF) === 9) {
                        terminal = 3;
                    }
                    while (offset < dataSize - 4) { // 4 === type(UI8) + ScriptDataObjectEnd(UI24)
                        let amfobj = flvDemux.parseObject(buffer, dataOffset, dataSize - offset - terminal);

                        if (amfobj.objectEnd)
                            break;
                        value[amfobj.data.name] = amfobj.data.value;
                        dataOffset += amfobj.size;
                    }
                    if (offset <= dataSize - 3) {
                        let marker = v.getUint32(dataOffset - 1, !le) & 0x00FFFFFF;
                        if (marker === 9) {
                            dataOffset += 3;
                        }
                    }
                    break;
                }
            case 8:
                { // ECMA array type (Mixed array)
                    value = {};
                    // dataOffset += 1;
                    dataOffset += 4; // ECMAArrayLength(UI32)
                    let terminal = 0; // workaround for malformed MixedArrays which has missing ScriptDataObjectEnd
                    if ((dv.getUint32(dataSize - 4, !le) & 0x00FFFFFF) === 9) {
                        terminal = 3;
                    }
                    while (dataOffset < dataSize - 8) { // 8 === type(UI8) + ECMAArrayLength(UI32) + ScriptDataVariableEnd(UI24)
                        let amfvar = flvDemux.parseVariable(buffer, dataOffset);

                        if (amfvar.objectEnd)
                            break;
                        value[amfvar.data.name] = amfvar.data.value;
                        dataOffset = amfvar.size;
                    }
                    if (dataOffset <= dataSize - 3) {
                        let marker = dv.getUint32(dataOffset - 1, !le) & 0x00FFFFFF;
                        if (marker === 9) {
                            dataOffset += 3;
                        }
                    }
                    break;
                }
            case 9: // ScriptDataObjectEnd
                value = undefined;
                dataOffset = 1;
                objectEnd = true;
                break;
            case 10:
                { // Strict array type
                    // ScriptDataValue[n]. NOTE: according to video_file_format_spec_v10_1.pdf
                    value = [];
                    let strictArrayLength = dv.getUint32(dataOffset, !le);
                    dataOffset += 4;
                    for (let i = 0; i < strictArrayLength; i++) {
                        let val = flvDemux.parseScript(buffer, dataOffset);
                        value.push(val.data);
                        dataOffset = val.size;
                    }
                    break;
                }
            case 11:
                { // Date type
                    let date = flvDemux.parseDate(buffer, dataOffset + 1, dataSize - 1);
                    value = date.data;
                    dataOffset += date.size;
                    break;
                }
            case 12:
                { // Long string type
                    let amfLongStr = flvDemux.parseString(buffer, dataOffset + 1, dataSize - 1);
                    value = amfLongStr.data;
                    dataOffset += amfLongStr.size;
                    break;
                }
            default:
                // ignore and skip
                dataOffset = dataSize;
                console.log('AMF', 'Unsupported AMF value type ' + type);
        }
        return {
            data: value,
            size: dataOffset,
        };
    }
}