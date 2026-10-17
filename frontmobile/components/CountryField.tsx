import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { filterCountries, findCountryByName, getCountryList, type Country } from '@/services/countries';

type Props = {
  label: string;
  /** Country name as stored in the request (e.g. `Sénégal`); a legacy free-text value is shown as is. */
  value: string | undefined;
  onChange: (countryName: string) => void;
  disabled: boolean;
  error: string | undefined;
  colors: (typeof Colors)['light'];
};

// Country picker: a field that opens a searchable list of countries (libphonenumber-js codes, French names).
export const CountryField = ({ label, value, onChange, disabled, error, colors }: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const countries = useMemo(() => getCountryList('fr'), []);
  const results = useMemo(() => filterCountries(countries, query), [countries, query]);
  const selected = findCountryByName(countries, value);
  const shown = selected ? `${selected.flag}  ${selected.name}` : value;
  const borderColor = error ? colors['state.error.fg'] : colors['text.muted'];

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const pick = (country: Country) => {
    onChange(country.name);
    close();
  };

  return (
    <View>
      <TouchableOpacity
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${value ?? 'choisir un pays'}`}
        style={[
          styles.field,
          { backgroundColor: colors['surface.default'], borderColor, opacity: disabled ? 0.6 : 1 },
        ]}
      >
        <Text style={{ fontSize: 16, color: shown ? colors['text.primary'] : colors['text.muted'] }}>
          {shown || 'Choisir un pays'}
        </Text>
      </TouchableOpacity>

      {/* statusBarTranslucent + fournisseur propre : les marges de la barre d'etat sont mesurees DANS la fenetre du modal. */}
      <Modal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
        <SafeAreaProvider>
        <SafeAreaView style={[styles.modal, { backgroundColor: colors['bg.default'] }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors['text.primary'] }]}>{label}</Text>
            <TouchableOpacity onPress={close} accessibilityRole="button" accessibilityLabel="Fermer" hitSlop={16} style={styles.closeTarget}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors['brand.primary'] }}>Fermer</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un pays"
            placeholderTextColor={colors['text.muted']}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Rechercher un pays"
            style={[
              styles.search,
              { color: colors['text.primary'], backgroundColor: colors['surface.default'], borderColor: colors['text.muted'] },
            ]}
          />
          <FlatList
            data={results}
            keyExtractor={(country) => country.code}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors['text.secondary'] }]}>Aucun pays ne correspond.</Text>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => pick(item)}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                accessibilityState={{ selected: item.name === selected?.name }}
                style={[styles.row, { borderBottomColor: colors['text.muted'] }]}
              >
                <Text style={styles.flag}>{item.flag}</Text>
                <Text
                  style={{
                    fontSize: 16,
                    color: item.name === selected?.name ? colors['brand.primary'] : colors['text.primary'],
                    fontWeight: item.name === selected?.name ? '600' : '400',
                  }}
                >
                  {item.name}
                </Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  field: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, justifyContent: 'center' },
  modal: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
  title: { fontSize: 18, fontWeight: '600' },
  closeTarget: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  flag: { fontSize: 22 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 14 },
});
