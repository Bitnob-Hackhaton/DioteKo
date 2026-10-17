import { StyleSheet, TextInput, View, Text, Image, TouchableOpacity, Modal, FlatList } from 'react-native';
import React, { useState } from 'react';
import { icons } from '@/constants/icons';
import { AsYouType,CountryCode  } from 'libphonenumber-js';

interface FormFieldIconeProps {
  value: string;
  secureTextEntry?: boolean;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  placeholder?: string;
  leftIcon?: React.ReactNode | string;
  rightIcon?: React.ReactNode | string;
  inputStyle?: object;
  label?: string;
  isPhone?: boolean;
  onPhoneChange?: (formattedNumber: string, countryCode: string) => void;
  isValid?: boolean;
  showValidation?: boolean;
}

function countryCodeToEmoji(countryCode:string) {
  return countryCode
    .toUpperCase()
    .split('')
    .map(char => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
    //Exemple tranformation countryCodeToEmoji(SN)=>'🇸🇳'
}

const countries = [
  { code: 'SN', name: 'Sénégal', dialCode: '+221', placeholder: '77 777 77 77' },
  /*{ code: 'FR', name: 'France', dialCode: '+33', placeholder: '06 12 34 56 78' },
  { code: 'US', name: 'États-Unis', dialCode: '+1', placeholder: '(201) 555-0123' },
  { code: 'ML', name: 'Mali', dialCode: '+223', placeholder: '' },
  { code: 'CI', name: 'Côte d\'Ivoire', dialCode: '+225', placeholder: '' },
  { code: 'BF', name: 'Burkina Faso', dialCode: '+226', placeholder: '' },
  { code: 'NE', name: 'Niger', dialCode: '+227', placeholder: '' },
  { code: 'TD', name: 'Tchad', dialCode: '+235', placeholder: '' },*/
];

const FormFieldIcone = ({
  value,
  label,
  onChangeText,
  keyboardType = 'default',
  placeholder = '',
  secureTextEntry = false,
  leftIcon = null,
  rightIcon = null,
  inputStyle = {},
  isPhone = false,
  onPhoneChange,
  isValid = true,
  showValidation = false,
}: FormFieldIconeProps) => {
  const [selectedCountry, setSelectedCountry] = useState(countries[0]); // Sénégal par défaut
  const [showCountryModal, setShowCountryModal] = useState(false);

  return (
    <View className='w-full'>
      <Text style={{ fontSize: 14, color: '#374151', marginBottom: 4, paddingLeft: 4 }}>
        {label}
      </Text>

      {isPhone ? (
        <>
          <View
            className='border rounded-lg bg-white px-1 flex-row items-center'
            style={{
              height: 40,
              borderColor: showValidation ? (isValid ? '#10B981' : '#EF4444') : '#B3B3B3',
              borderWidth: 1,
            }}
          >
            <TouchableOpacity
              onPress={() => setShowCountryModal(true)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 20, marginRight: 4 }}>{countryCodeToEmoji(selectedCountry.code)}</Text>
              <Text style={{ color: '#000000', fontSize: 14 }}>{selectedCountry.dialCode}</Text>
            </TouchableOpacity>

            <TextInput
              placeholder={selectedCountry.placeholder}
              autoCapitalize='none'
              autoCorrect={false}
              value={value}
              onChangeText={(text) => {
                const numeric = text.replace(/\D/g, ''); // Supprimer tout sauf chiffres
                const formatter = new AsYouType(selectedCountry.code as CountryCode);
                const formatted = formatter.input(numeric);

                onChangeText(formatted);

                if (onPhoneChange) {
                  const fullNumber = formatter.getNumber()?.number || '';
                  onPhoneChange(fullNumber, selectedCountry.code);
                }
              }}
              keyboardType='phone-pad'
              placeholderTextColor='#888'
              style={{
                color: '#000000',
                fontSize: 14,
                padding: 6,
                backgroundColor: '#ffffff',
                height: 32,
                flex: 1,
              }}
            />

            {showValidation && (
              <View className='px-2'>
                <Text style={{ fontSize: 16, color: isValid ? '#10B981' : '#B3B3B3' }}>
                  {isValid ? '✓' : '✗'}
                </Text>
              </View>
            )}
          </View>

          <Modal
            visible={showCountryModal}
            transparent={true}
            animationType='slide'
            onRequestClose={() => setShowCountryModal(false)}
          >
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
              activeOpacity={1}
              onPress={() => setShowCountryModal(false)}
            >
              <TouchableOpacity
                style={{
                  backgroundColor: 'white',
                  borderTopLeftRadius: 20,
                  borderTopRightRadius: 20,
                  maxHeight: '50%',
                }}
                activeOpacity={1}
                onPress={() => {}}
              >
                <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                  <Text style={{ fontSize: 18, fontWeight: 'bold', textAlign: 'center' }}>
                    Sélectionner un pays
                  </Text>
                </View>
                <FlatList
                  data={countries}
                  keyExtractor={(item) => item.code}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 15,
                        borderBottomWidth: 1,
                        borderBottomColor: '#f0f0f0',
                      }}
                      onPress={() => {
                        setSelectedCountry(item);
                        setShowCountryModal(false);
                      }}
                    >
                      <Text style={{ fontSize: 24, marginRight: 15 }}>{countryCodeToEmoji(item.code)}</Text>
                      <Text style={{ fontSize: 16, flex: 1 }}>{item.name}</Text>
                      <Text style={{ fontSize: 16, color: '#666' }}>{item.dialCode}</Text>
                    </TouchableOpacity>
                  )}
                />
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        </>
      ) : (
        <View
          className='border rounded-lg bg-white px-1 flex-row items-center'
          style={{
            borderColor: showValidation ? (isValid ? '#10B981' : '#EF4444') : '#B3B3B3',
            borderWidth: 1,
          }}
        >
          {leftIcon && (
            <>
              <View>{leftIcon}</View>
              <View>
                <Image source={icons.ligne} className='size-4' resizeMode='stretch' />
              </View>
            </>
          )}
          <TextInput
            placeholder={placeholder}
            autoCapitalize='none'
            autoCorrect={false}
            value={value}
            secureTextEntry={secureTextEntry}
            onChangeText={onChangeText}
            keyboardType={keyboardType}
            placeholderTextColor='#888'
            style={{
              color: '#000000',
              fontSize: 14,
              padding: 6,
              backgroundColor: '#ffffff',
              height: 32,
              flex: 1,
            }}
          />
          {showValidation && (
            <View className='px-2'>
              <Text style={{ fontSize: 16, color: isValid ? '#10B981' : '#EF4444' }}>
                {isValid ? '✓' : '✗'}
              </Text>
            </View>
          )}
          {rightIcon && <View className='ml-2'>{rightIcon}</View>}
        </View>
      )}
    </View>
  );
};

export default FormFieldIcone;

const styles = StyleSheet.create({});
