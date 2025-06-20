import { RouteProp, StackActions, useIsFocused, useRoute } from '@react-navigation/native';
import * as bitcoin from 'bitcoinjs-lib';
import createHash from 'create-hash';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Base43 from '../../blue_modules/base43';
import * as fs from '../../blue_modules/fs';
import { BlueURDecoder, decodeUR, extractSingleWorkload } from '../../blue_modules/ur';
import { BlueSpacing40, BlueText } from '../../BlueComponents';
import { openPrivacyDesktopSettings } from '../../class/camera';
import Button from '../../components/Button';
import { useTheme } from '../../components/themes';
import { isCameraAuthorizationStatusGranted } from '../../helpers/scan-qr';
import loc from '../../loc';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import CameraScreen from '../../components/CameraScreen';
import SafeArea from '../../components/SafeArea';
import presentAlert from '../../components/Alert';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList.ts';
import { BlueLoading } from '../../components/BlueLoading.tsx';

let decoder: BlueURDecoder | undefined;

type RouteProps = RouteProp<SendDetailsStackParamList, 'ScanQRCode'>;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  openSettingsContainer: {
    justifyContent: 'center',
    alignContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  backdoorButton: {
    width: 60,
    height: 60,
    backgroundColor: 'rgba(0,0,0,0.01)',
    position: 'absolute',
    top: 60,
    left: '50%',
    transform: [{ translateX: -30 }],
  },
  backdoorInputWrapper: { position: 'absolute', left: '5%', top: '0%', width: '90%', height: '70%', backgroundColor: 'white' },
  progressWrapper: { position: 'absolute', alignSelf: 'center', alignItems: 'center', top: '50%', padding: 8, borderRadius: 8 },
  backdoorInput: {
    height: '50%',
    marginTop: 5,
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 4,
    textAlignVertical: 'top',
  },
});

const ScanQRCode = () => {
  const [isLoading, setIsLoading] = useState(false);
  const navigation = useExtendedNavigation();
  const route = useRoute<RouteProps>();
  const navigationState = navigation.getState();
  const previousRoute = navigationState.routes[navigationState.routes.length - 2];
  const defaultLaunchedBy = previousRoute ? previousRoute.name : undefined;

  const { launchedBy = defaultLaunchedBy, showFileImportButton, onBarScanned } = route.params || {};
  const scannedCache: Record<string, number> = {};
  const { colors } = useTheme();
  const isFocused = useIsFocused();
  const [backdoorPressed, setBackdoorPressed] = useState(0);
  const [urTotal, setUrTotal] = useState(0);
  const [urHave, setUrHave] = useState(0);
  const [backdoorText, setBackdoorText] = useState('');
  const [backdoorVisible, setBackdoorVisible] = useState(false);
  const [animatedQRCodeData, setAnimatedQRCodeData] = useState<Record<string, string>>({});
  const [cameraStatusGranted, setCameraStatusGranted] = useState<boolean | undefined>(undefined);
  const stylesHook = StyleSheet.create({
    openSettingsContainer: {
      backgroundColor: colors.brandingColor,
    },
    progressWrapper: { backgroundColor: colors.brandingColor, borderColor: colors.foregroundColor, borderWidth: 4 },
    backdoorInput: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
      color: colors.foregroundColor,
    },
  });

  useEffect(() => {
    isCameraAuthorizationStatusGranted().then(setCameraStatusGranted);
  }, []);

  const HashIt = function (s: string): string {
    return createHash('sha256').update(s).digest().toString('hex');
  };

  const _onReadUniformResourceV2 = (part: string) => {
    if (!decoder) decoder = new BlueURDecoder();
    try {
      decoder.receivePart(part);
      if (decoder.isComplete()) {
        const data = decoder.toString();
        decoder = undefined; // nullify for future use (?)
        if (launchedBy) {
          const merge = true;
          const popToAction = StackActions.popTo(launchedBy, { onBarScanned: data }, { merge });
          if (onBarScanned) {
            onBarScanned(data);
          }

          navigation.dispatch(popToAction);
        }
      } else {
        setUrTotal(100);
        setUrHave(Math.floor(decoder.estimatedPercentComplete() * 100));
      }
    } catch (error) {
      setIsLoading(true);
      presentAlert({
        title: loc.errors.error,
        message: loc._.invalid_animated_qr_code_fragment,
      });
    }
  };

  /**
   *
   * @deprecated remove when we get rid of URv1 support
   */
  const _onReadUniformResource = (ur: string) => {
    try {
      const [index, total] = extractSingleWorkload(ur);
      animatedQRCodeData[index + 'of' + total] = ur;
      setUrTotal(total);
      setUrHave(Object.values(animatedQRCodeData).length);
      if (Object.values(animatedQRCodeData).length === total) {
        const payload = decodeUR(Object.values(animatedQRCodeData));
        // lets look inside that data
        let data: false | string = false;
        if (Buffer.from(String(payload), 'hex').toString().startsWith('psbt')) {
          // its a psbt, and whoever requested it expects it encoded in base64
          data = Buffer.from(String(payload), 'hex').toString('base64');
        } else {
          // its something else. probably plain text is expected
          data = Buffer.from(String(payload), 'hex').toString();
        }
        if (launchedBy) {
          const merge = true;
          const popToAction = StackActions.popTo(launchedBy, { onBarScanned: data }, { merge });
          if (onBarScanned) {
            onBarScanned(data);
          }

          navigation.dispatch(popToAction);
        }
      } else {
        setAnimatedQRCodeData(animatedQRCodeData);
      }
    } catch (error) {
      setIsLoading(true);

      presentAlert({
        title: loc.errors.error,
        message: loc._.invalid_animated_qr_code_fragment,
      });
    }
  };

  const onBarCodeRead = (ret: { data: string }) => {
    console.log('📱 onBarCodeRead: Received QR data:', ret.data);
    console.log('📱 onBarCodeRead: launchedBy:', launchedBy);
    console.log('📱 onBarCodeRead: onBarScanned callback exists:', !!onBarScanned);
    
    const h = HashIt(ret.data);
    if (scannedCache[h]) {
      // this QR was already scanned by this ScanQRCode, lets prevent firing duplicate callbacks
      console.log('📱 onBarCodeRead: Data already scanned, ignoring duplicate');
      return;
    }
    scannedCache[h] = +new Date();

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-ACCOUNT')) {
      console.log('📱 onBarCodeRead: Processing UR:CRYPTO-ACCOUNT');
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-PSBT')) {
      console.log('📱 onBarCodeRead: Processing UR:CRYPTO-PSBT');
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-OUTPUT')) {
      console.log('📱 onBarCodeRead: Processing UR:CRYPTO-OUTPUT');
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:BYTES')) {
      const splitted = ret.data.split('/');
      if (splitted.length === 3 && splitted[1].includes('-')) {
        console.log('📱 onBarCodeRead: Processing UR:BYTES');
        return _onReadUniformResourceV2(ret.data);
      }
    }

    if (ret.data.toUpperCase().startsWith('UR')) {
      console.log('📱 onBarCodeRead: Processing UR');
      return _onReadUniformResource(ret.data);
    }

    // is it base43? stupid electrum desktop
    try {
      const hex = Base43.decode(ret.data);
      bitcoin.Psbt.fromHex(hex); // if it doesnt throw - all good
      const data = Buffer.from(hex, 'hex').toString('base64');

      console.log('📱 onBarCodeRead: Processed as base43, navigating back with data');
      if (launchedBy) {
        const merge = true;
        const popToAction = StackActions.popTo(launchedBy, { onBarScanned: data }, { merge });
        if (onBarScanned) {
          console.log('📱 onBarCodeRead: Calling onBarScanned callback with base43 data');
          onBarScanned(data);
        }
        navigation.dispatch(popToAction);
      }
      return;
    } catch (_) {
      console.log('📱 onBarCodeRead: Not base43, processing as regular data');
      if (!isLoading && launchedBy) {
        setIsLoading(true);
        try {
          const merge = true;

          console.log('📱 onBarCodeRead: Navigating back with regular data:', ret.data);
          const popToAction = StackActions.popTo(launchedBy, { onBarScanned: ret.data }, { merge });
          if (onBarScanned) {
            console.log('📱 onBarCodeRead: Calling onBarScanned callback with regular data');
            onBarScanned(ret.data);
          }

          navigation.dispatch(popToAction);
        } catch (e) {
          console.log('📱 onBarCodeRead: Error during navigation:', e);
        }
      }
    }
    setIsLoading(false);
  };

  const showFilePicker = async () => {
    setIsLoading(true);
    const { data } = await fs.showFilePickerAndReadFile();
    if (data) onBarCodeRead({ data });
    setIsLoading(false);
  };

  const onShowImagePickerButtonPress = () => {
    console.log('📱 onShowImagePickerButtonPress: Starting image picker flow');
    if (!isLoading) {
      setIsLoading(true);
      fs.showImagePickerAndReadImage()
        .then(data => {
          console.log('📱 onShowImagePickerButtonPress: Image picker returned data:', data);
          if (data) {
            console.log('📱 onShowImagePickerButtonPress: Calling onBarCodeRead with data');
            onBarCodeRead({ data });
          } else {
            console.log('📱 onShowImagePickerButtonPress: No data returned from image picker');
          }
        })
        .catch(error => {
          console.error('📱 onShowImagePickerButtonPress: Error from image picker:', error);
        })
        .finally(() => {
          console.log('📱 onShowImagePickerButtonPress: Finished, setting loading to false');
          setIsLoading(false);
        });
    } else {
      console.log('📱 onShowImagePickerButtonPress: Already loading, ignoring request');
    }
  };

  const dismiss = () => {
    navigation.goBack();
  };

  const handleReadCode = (event: any) => {
    onBarCodeRead({ data: event?.nativeEvent?.codeStringValue });
  };

  const handleBackdoorOkPress = () => {
    setBackdoorVisible(false);
    setBackdoorText('');
    if (backdoorText) onBarCodeRead({ data: backdoorText });
  };

  // this is an invisible backdoor button on bottom left screen corner
  // tapping it 10 times fires prompt dialog asking for a string thats gona be passed to onBarCodeRead.
  // this allows to mock and test QR scanning in e2e tests
  const handleInvisibleBackdoorPress = async () => {
    setBackdoorPressed(backdoorPressed + 1);
    if (backdoorPressed < 5) return;
    setBackdoorPressed(0);
    setBackdoorVisible(true);
  };

  const render = isLoading ? (
    <BlueLoading />
  ) : (
    <View>
      {cameraStatusGranted === false ? (
        <View style={[styles.openSettingsContainer, stylesHook.openSettingsContainer]}>
          <BlueText>{loc.send.permission_camera_message}</BlueText>
          <BlueSpacing40 />
          <Button title={loc.send.open_settings} onPress={openPrivacyDesktopSettings} />
          <BlueSpacing40 />
          {showFileImportButton && <Button title={loc.wallets.import_file} onPress={showFilePicker} />}
          <BlueSpacing40 />
          <Button title={loc.wallets.list_long_choose} onPress={onShowImagePickerButtonPress} />
          <BlueSpacing40 />
          <Button title={loc._.cancel} onPress={dismiss} />
        </View>
      ) : isFocused && cameraStatusGranted ? (
        <CameraScreen
          onReadCode={handleReadCode}
          showFilePickerButton={showFileImportButton}
          showImagePickerButton={true}
          onFilePickerButtonPress={showFilePicker}
          onImagePickerButtonPress={onShowImagePickerButtonPress}
          onCancelButtonPress={dismiss}
        />
      ) : null}
      {urTotal > 0 && (
        <View style={[styles.progressWrapper, stylesHook.progressWrapper]} testID="UrProgressBar">
          <BlueText>{loc.wallets.please_continue_scanning}</BlueText>
          <BlueText>
            {urHave} / {urTotal}
          </BlueText>
        </View>
      )}
      {backdoorVisible && (
        <View style={styles.backdoorInputWrapper}>
          <BlueText>Provide QR code contents manually:</BlueText>
          <TextInput
            testID="scanQrBackdoorInput"
            multiline
            underlineColorAndroid="transparent"
            style={[styles.backdoorInput, stylesHook.backdoorInput]}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            selectTextOnFocus={false}
            keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
            value={backdoorText}
            onChangeText={setBackdoorText}
          />
          <Button title="OK" testID="scanQrBackdoorOkButton" onPress={handleBackdoorOkPress} />
        </View>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={loc._.qr_custom_input_button}
        testID="ScanQrBackdoorButton"
        style={styles.backdoorButton}
        onPress={handleInvisibleBackdoorPress}
      />
    </View>
  );

  return <SafeArea style={styles.root}>{render}</SafeArea>;
};

export default ScanQRCode;
